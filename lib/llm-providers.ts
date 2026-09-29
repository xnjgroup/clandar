/**
 * LLM providers: any OpenAI-compatible chat endpoint — OpenAI itself, or a
 * locally hosted server like LM Studio, Ollama, or vLLM. `base_url` is the
 * API root including its version path (e.g. an LM Studio server on the LAN is
 * typically `http://<host>:1234/v1`); this module appends `/models` and
 * `/chat/completions` to it.
 *
 * The API key is optional — most local servers don't check one — and is
 * encrypted the same way connector secrets are (`lib/crypto.ts`).
 */
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { query, queryOne } from "@/lib/db";

export type ProviderStatus = "unverified" | "connected" | "error" | "disabled";

export type LlmProvider = {
  id: string;
  name: string;
  baseUrl: string;
  /** Picked from `availableModels` after a successful test — null until then. */
  model: string | null;
  hasApiKey: boolean;
  isDefault: boolean;
  /** The provider the Gmail cleanup worker uses to judge/explain messages. */
  isEmailAnalyzer: boolean;
  enabled: boolean;
  status: ProviderStatus;
  statusDetail: string | null;
  availableModels: string[];
  lastCheckedAt: Date | null;
};

type ProviderRow = {
  id: string;
  name: string;
  base_url: string;
  model: string | null;
  has_api_key: boolean;
  is_default: boolean;
  is_email_analyzer: boolean;
  is_enabled: boolean;
  status: ProviderStatus;
  status_detail: string | null;
  available_models: string[];
  last_checked_at: Date | null;
};

const SELECT_COLUMNS = `id, name, base_url, model, (api_key_cipher IS NOT NULL) AS has_api_key,
       is_default, is_email_analyzer, is_enabled, status, status_detail, available_models, last_checked_at`;

function toProvider(row: ProviderRow): LlmProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    hasApiKey: row.has_api_key,
    isDefault: row.is_default,
    isEmailAnalyzer: row.is_email_analyzer,
    enabled: row.is_enabled,
    status: row.status,
    statusDetail: row.status_detail,
    availableModels: row.available_models,
    lastCheckedAt: row.last_checked_at,
  };
}

export async function listLlmProviders(orgId: string): Promise<LlmProvider[]> {
  const rows = await query<ProviderRow>(
    `SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE org_id = $1 ORDER BY is_default DESC, created_at`,
    [orgId],
  );
  return rows.map(toProvider);
}

export async function getLlmProvider(id: string): Promise<LlmProvider | null> {
  const row = await queryOne<ProviderRow>(`SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE id = $1`, [
    id,
  ]);
  return row ? toProvider(row) : null;
}

/** `getLlmProvider`, but `null` unless it also belongs to `orgId`. */
export async function getLlmProviderForOrg(id: string, orgId: string): Promise<LlmProvider | null> {
  const row = await queryOne<{ org_id: string }>(`SELECT org_id FROM llm_providers WHERE id = $1`, [id]);
  if (!row || row.org_id !== orgId) return null;
  return getLlmProvider(id);
}

/** The provider features should use when none is named explicitly — `null` if none is set default, or configured at all. */
export async function defaultLlmProvider(orgId: string): Promise<LlmProvider | null> {
  const row = await queryOne<ProviderRow>(
    `SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE org_id = $1 AND is_default AND is_enabled`,
    [orgId],
  );
  return row ? toProvider(row) : null;
}

/** The provider the Gmail cleanup worker calls — falls back to the default if none is assigned specifically. */
export async function emailAnalyzerProvider(orgId: string): Promise<LlmProvider | null> {
  const row = await queryOne<ProviderRow>(
    `SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE org_id = $1 AND is_email_analyzer AND is_enabled`,
    [orgId],
  );
  if (row) return toProvider(row);
  return defaultLlmProvider(orgId);
}

/**
 * Always inserts as non-default with no model chosen yet — `probeLlmProvider`
 * fills in the model from whatever the endpoint reports, and callers that want
 * the new row to become the default call `setDefaultLlmProvider` afterward,
 * which is the only place that safely juggles the "at most one" constraint.
 */
export async function createLlmProvider(input: {
  orgId: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  createdBy: string | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO llm_providers (org_id, name, base_url, api_key_cipher, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.orgId, input.name, input.baseUrl, input.apiKey ? encryptSecret(input.apiKey) : null, input.createdBy],
  );
  return row!.id;
}

/** Picks which of the endpoint's models a provider uses. */
export async function setLlmProviderModel(id: string, orgId: string, model: string) {
  await query(`UPDATE llm_providers SET model = $3 WHERE id = $1 AND org_id = $2`, [id, orgId, model]);
}

/** Makes exactly this provider the default within its org — one statement, so the "at most one" index is never transiently violated. */
export async function setDefaultLlmProvider(id: string, orgId: string) {
  await query(`UPDATE llm_providers SET is_default = (id = $1) WHERE org_id = $2`, [id, orgId]);
}

/** Assigns exactly this provider to analyze email — same one-statement pattern as `setDefaultLlmProvider`. */
export async function setEmailAnalyzerProvider(id: string, orgId: string) {
  await query(`UPDATE llm_providers SET is_email_analyzer = (id = $1) WHERE org_id = $2`, [id, orgId]);
}

export async function setLlmProviderEnabled(id: string, orgId: string, enabled: boolean) {
  await query(
    `UPDATE llm_providers
        SET is_enabled = $3,
            is_default = is_default AND $3,
            is_email_analyzer = is_email_analyzer AND $3,
            status = CASE WHEN $3 THEN 'unverified' ELSE 'disabled' END
      WHERE id = $1 AND org_id = $2`,
    [id, orgId, enabled],
  );
}

export async function deleteLlmProvider(id: string, orgId: string) {
  await query(`DELETE FROM llm_providers WHERE id = $1 AND org_id = $2`, [id, orgId]);
}

/* ── Probe ────────────────────────────────────────────────── */

const PROBE_TIMEOUT_MS = 10_000;

function trimTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function authHeaders(id: string): Promise<Record<string, string>> {
  const row = await queryOne<{ api_key_cipher: string | null }>(
    `SELECT api_key_cipher FROM llm_providers WHERE id = $1`,
    [id],
  );
  if (!row?.api_key_cipher) return {};
  return { Authorization: `Bearer ${decryptSecret(row.api_key_cipher)}` };
}

/** Turns a fetch/JSON failure into a message worth showing, with the common misconfigurations named. */
async function describeFailure(error: unknown, response: Response | null, baseUrl: string) {
  if (response) {
    if (response.status === 401 || response.status === 403) {
      return `The server rejected the API key (HTTP ${response.status}).`;
    }
    if (response.status === 404) {
      return `HTTP 404 at ${baseUrl}/models — check the base URL includes its version path (often "/v1").`;
    }
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } | string };
      detail =
        typeof body.error === "string" ? body.error : (body.error?.message ?? "");
    } catch {
      // Not every OpenAI-compatible server returns JSON on error.
    }
    return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`;
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return `No response within ${PROBE_TIMEOUT_MS / 1000}s`;
    if (error.message === "fetch failed") {
      const code = (error.cause as { code?: string } | undefined)?.code;
      if (code === "ECONNREFUSED") return `Nothing is listening at ${baseUrl}`;
      if (code === "ENOTFOUND") return `Host in ${baseUrl} could not be resolved`;
      return `Could not reach ${baseUrl}${code ? ` (${code})` : ""}`;
    }
    return error.message;
  }
  return "Unknown error";
}

/**
 * Lists the models the endpoint serves — the standard OpenAI-compatible way to
 * check that a base URL and key actually work, without generating anything.
 */
export async function probeLlmProvider(id: string, orgId: string): Promise<{ ok: boolean; message: string }> {
  const provider = await getLlmProviderForOrg(id, orgId);
  if (!provider) return { ok: false, message: "Provider not found" };
  const baseUrl = trimTrailingSlash(provider.baseUrl);

  let response: Response | null = null;
  try {
    response = await fetch(`${baseUrl}/models`, {
      headers: await authHeaders(id),
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const message = await describeFailure(null, response, baseUrl);
      await recordProbe(id, orgId, false, message, []);
      return { ok: false, message };
    }

    const body = (await response.json()) as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id).sort();
    // Auto-pick a model the first time, or if whatever was selected disappeared
    // (e.g. LM Studio unloaded it) — otherwise leave the user's choice alone.
    const keepModel = provider.model && models.includes(provider.model) ? provider.model : null;
    const nextModel = keepModel ?? models[0] ?? null;
    const message =
      models.length > 0
        ? `${models.length} model${models.length === 1 ? "" : "s"} available`
        : "Connected — the server reported no models";
    await recordProbe(id, orgId, true, message, models, nextModel);
    return { ok: true, message };
  } catch (error) {
    const message = await describeFailure(error, response, baseUrl);
    await recordProbe(id, orgId, false, message, []);
    return { ok: false, message };
  }
}

/** A content part in the OpenAI vision format — a data: URL works with every OpenAI-compatible server this app talks to, no separate upload step. */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

/**
 * A single, non-streaming chat completion against a provider's own chosen
 * model — what the Gmail cleanup worker calls to judge a batch of messages.
 * Throws with a message fit to show or log; callers decide how to handle it.
 */
export async function chatComplete(
  providerId: string,
  messages: ChatMessage[],
  options: { temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  const provider = await getLlmProvider(providerId);
  if (!provider) throw new Error("LLM provider not found");
  if (!provider.model) throw new Error(`${provider.name} has no model selected — test it on /settings first`);

  const baseUrl = trimTrailingSlash(provider.baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders(providerId)) },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: options.temperature ?? 0,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  }).catch((error: unknown) => {
    throw new Error(`Could not reach ${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`);
  });

  if (!response.ok) {
    throw new Error(`${provider.name} chat completion failed: ${await describeFailure(null, response, baseUrl)}`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider.name} returned no completion content`);
  return content;
}

async function recordProbe(
  id: string,
  orgId: string,
  ok: boolean,
  detail: string,
  models: string[],
  model: string | null = null,
) {
  await query(
    `UPDATE llm_providers
        SET status = $3,
            status_detail = $4,
            available_models = COALESCE($5::jsonb, available_models),
            model = COALESCE($6, model),
            last_checked_at = now()
      WHERE id = $1 AND org_id = $2`,
    [
      id,
      orgId,
      ok ? "connected" : "error",
      detail.slice(0, 500),
      models.length > 0 ? JSON.stringify(models) : null,
      model,
    ],
  );
}
