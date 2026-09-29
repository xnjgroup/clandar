/**
 * Platform-wide LLM providers — admin-only (see lib/admin.ts), configured at
 * /admin. Not tied to any org; `lib/llm-providers.ts`'s `defaultLlmProvider`
 * falls back to whichever one here is marked default when an org hasn't
 * configured (or enabled) its own — an org's own provider always wins.
 *
 * Deliberately a near-duplicate of lib/llm-providers.ts's shape/probe logic
 * rather than a shared abstraction: same well-tested behavior, one table
 * instead of two call patterns to keep straight.
 */
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { query, queryOne } from "@/lib/db";
import type { LlmProvider, ProviderStatus } from "@/lib/llm-providers";

type Row = {
  id: string;
  name: string;
  base_url: string;
  model: string | null;
  has_api_key: boolean;
  is_default: boolean;
  is_enabled: boolean;
  status: ProviderStatus;
  status_detail: string | null;
  available_models: string[];
  last_checked_at: Date | null;
};

const SELECT_COLUMNS = `id, name, base_url, model, (api_key_cipher IS NOT NULL) AS has_api_key,
       is_default, is_enabled, status, status_detail, available_models, last_checked_at`;

function toProvider(row: Row): LlmProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    hasApiKey: row.has_api_key,
    isDefault: row.is_default,
    isEmailAnalyzer: false, // org-specific concept — a platform provider is never assigned that role directly
    isChatProvider: false, // same — chat provider is an org-level assignment, not a platform one
    emailModel: null,
    chatModel: null,
    enabled: row.is_enabled,
    status: row.status,
    statusDetail: row.status_detail,
    availableModels: row.available_models,
    lastCheckedAt: row.last_checked_at,
  };
}

export async function listPlatformLlmProviders(): Promise<LlmProvider[]> {
  const rows = await query<Row>(`SELECT ${SELECT_COLUMNS} FROM platform_llm_providers ORDER BY is_default DESC, created_at`);
  return rows.map(toProvider);
}

export async function getPlatformLlmProvider(id: string): Promise<LlmProvider | null> {
  const row = await queryOne<Row>(`SELECT ${SELECT_COLUMNS} FROM platform_llm_providers WHERE id = $1`, [id]);
  return row ? toProvider(row) : null;
}

/** What every org falls back to when it hasn't configured (or enabled) its own default. */
export async function platformDefaultLlmProvider(): Promise<LlmProvider | null> {
  const row = await queryOne<Row>(
    `SELECT ${SELECT_COLUMNS} FROM platform_llm_providers WHERE is_default AND is_enabled`,
  );
  return row ? toProvider(row) : null;
}

export async function createPlatformLlmProvider(input: {
  name: string;
  baseUrl: string;
  apiKey: string | null;
  createdBy: string | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO platform_llm_providers (name, base_url, api_key_cipher, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.name, input.baseUrl, input.apiKey ? encryptSecret(input.apiKey) : null, input.createdBy],
  );
  return row!.id;
}

export async function setPlatformLlmProviderModel(id: string, model: string) {
  await query(`UPDATE platform_llm_providers SET model = $2 WHERE id = $1`, [id, model]);
}

export async function setPlatformDefaultLlmProvider(id: string) {
  await query(`UPDATE platform_llm_providers SET is_default = (id = $1)`, [id]);
}

export async function setPlatformLlmProviderEnabled(id: string, enabled: boolean) {
  await query(
    `UPDATE platform_llm_providers
        SET is_enabled = $2, is_default = is_default AND $2,
            status = CASE WHEN $2 THEN 'unverified' ELSE 'disabled' END
      WHERE id = $1`,
    [id, enabled],
  );
}

export async function deletePlatformLlmProvider(id: string) {
  await query(`DELETE FROM platform_llm_providers WHERE id = $1`, [id]);
}

/** The raw base URL + decrypted key a chat/probe call needs — shared shape with lib/llm-providers.ts's internal lookup. */
export async function platformProviderSecret(id: string): Promise<{ apiKeyCipher: string | null } | null> {
  const row = await queryOne<{ api_key_cipher: string | null }>(
    `SELECT api_key_cipher FROM platform_llm_providers WHERE id = $1`,
    [id],
  );
  return row ? { apiKeyCipher: row.api_key_cipher } : null;
}

/* ── Probe ────────────────────────────────────────────────── */

const PROBE_TIMEOUT_MS = 10_000;

function trimTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function authHeaders(id: string): Promise<Record<string, string>> {
  const secret = await platformProviderSecret(id);
  if (!secret?.apiKeyCipher) return {};
  return { Authorization: `Bearer ${decryptSecret(secret.apiKeyCipher)}` };
}

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
      detail = typeof body.error === "string" ? body.error : (body.error?.message ?? "");
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

export async function probePlatformLlmProvider(id: string): Promise<{ ok: boolean; message: string }> {
  const provider = await getPlatformLlmProvider(id);
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
      await recordProbe(id, false, message, []);
      return { ok: false, message };
    }

    const body = (await response.json()) as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id).sort();
    const keepModel = provider.model && models.includes(provider.model) ? provider.model : null;
    const nextModel = keepModel ?? models[0] ?? null;
    const message =
      models.length > 0
        ? `${models.length} model${models.length === 1 ? "" : "s"} available`
        : "Connected — the server reported no models";
    await recordProbe(id, true, message, models, nextModel);
    return { ok: true, message };
  } catch (error) {
    const message = await describeFailure(error, response, baseUrl);
    await recordProbe(id, false, message, []);
    return { ok: false, message };
  }
}

async function recordProbe(id: string, ok: boolean, detail: string, models: string[], model: string | null = null) {
  await query(
    `UPDATE platform_llm_providers
        SET status = $2, status_detail = $3,
            available_models = COALESCE($4::jsonb, available_models),
            model = COALESCE($5, model),
            last_checked_at = now()
      WHERE id = $1`,
    [id, ok ? "connected" : "error", detail.slice(0, 500), models.length > 0 ? JSON.stringify(models) : null, model],
  );
}
