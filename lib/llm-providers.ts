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
import { createParser } from "eventsource-parser";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { query, queryOne } from "@/lib/db";
import {
  getPlatformLlmProvider,
  platformDefaultLlmProvider,
  platformProviderSecret,
} from "@/lib/platform-llm-providers";

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
  /** The provider the Executive Assistant chat uses. */
  isChatProvider: boolean;
  /** Overrides `model` for email analysis specifically — null means use the provider's own default model. */
  emailModel: string | null;
  /** Overrides `model` for chat specifically — null means use the provider's own default model. */
  chatModel: string | null;
  /** The provider that reads invoices/receipts, and its optional model override. */
  isInvoiceProvider: boolean;
  invoiceModel: string | null;
  /** The provider that drafts quotes from project photos, and its optional model override. */
  isQuoteProvider: boolean;
  quoteModel: string | null;
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
  is_chat_provider: boolean;
  email_model: string | null;
  chat_model: string | null;
  is_invoice_provider: boolean;
  invoice_model: string | null;
  is_quote_provider: boolean;
  quote_model: string | null;
  is_enabled: boolean;
  status: ProviderStatus;
  status_detail: string | null;
  available_models: string[];
  last_checked_at: Date | null;
};

const SELECT_COLUMNS = `id, name, base_url, model, (api_key_cipher IS NOT NULL) AS has_api_key,
       is_default, is_email_analyzer, is_chat_provider, email_model, chat_model,
       is_invoice_provider, invoice_model, is_quote_provider, quote_model,
       is_enabled, status, status_detail, available_models, last_checked_at`;

function toProvider(row: ProviderRow): LlmProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    hasApiKey: row.has_api_key,
    isDefault: row.is_default,
    isEmailAnalyzer: row.is_email_analyzer,
    isChatProvider: row.is_chat_provider,
    emailModel: row.email_model,
    chatModel: row.chat_model,
    isInvoiceProvider: row.is_invoice_provider,
    invoiceModel: row.invoice_model,
    isQuoteProvider: row.is_quote_provider,
    quoteModel: row.quote_model,
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

/** Looks in `llm_providers` first, then `platform_llm_providers` — an id from `defaultLlmProvider`'s fallback lives in the latter. */
export async function getLlmProvider(id: string): Promise<LlmProvider | null> {
  const row = await queryOne<ProviderRow>(`SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE id = $1`, [
    id,
  ]);
  if (row) return toProvider(row);
  return getPlatformLlmProvider(id);
}

/** `getLlmProvider`, but `null` unless it also belongs to `orgId`. */
export async function getLlmProviderForOrg(id: string, orgId: string): Promise<LlmProvider | null> {
  const row = await queryOne<{ org_id: string }>(`SELECT org_id FROM llm_providers WHERE id = $1`, [id]);
  if (!row || row.org_id !== orgId) return null;
  return getLlmProvider(id);
}

/**
 * The provider features should use when none is named explicitly. An org's
 * own default always wins; with none configured (or enabled), this falls
 * back to whichever platform provider an admin has set as default at
 * /admin — `null` only if neither exists.
 */
export async function defaultLlmProvider(orgId: string): Promise<LlmProvider | null> {
  const row = await queryOne<ProviderRow>(
    `SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE org_id = $1 AND is_default AND is_enabled`,
    [orgId],
  );
  if (row) return toProvider(row);
  return platformDefaultLlmProvider();
}

/**
 * "Built-in" in /settings' Email and Chat sections: Clandar's own platform
 * provider (the one an admin set as default at /admin), not the org's own
 * default — which is only the fallback when no platform provider exists.
 */
async function builtInProvider(orgId: string): Promise<LlmProvider | null> {
  return (await platformDefaultLlmProvider()) ?? (await defaultLlmProvider(orgId));
}

/** The provider the Gmail cleanup worker (and lead finder) calls — "Built-in" (the platform provider) if none is assigned. */
export async function emailAnalyzerProvider(orgId: string): Promise<LlmProvider | null> {
  const row = await queryOne<ProviderRow>(
    `SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE org_id = $1 AND is_email_analyzer AND is_enabled`,
    [orgId],
  );
  if (row) return toProvider(row);
  return builtInProvider(orgId);
}

/** The provider the Executive Assistant chat calls (lib/assistant.ts) — "Built-in" (the platform provider) if none is assigned. */
export async function chatLlmProvider(orgId: string): Promise<LlmProvider | null> {
  const row = await queryOne<ProviderRow>(
    `SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE org_id = $1 AND is_chat_provider AND is_enabled`,
    [orgId],
  );
  if (row) return toProvider(row);
  return builtInProvider(orgId);
}

/** The provider that reads invoices/receipts (lib/document-ingest.ts) — "Built-in" (the platform provider) if none is assigned. */
export async function invoiceLlmProvider(orgId: string): Promise<LlmProvider | null> {
  const row = await queryOne<ProviderRow>(
    `SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE org_id = $1 AND is_invoice_provider AND is_enabled`,
    [orgId],
  );
  if (row) return toProvider(row);
  return builtInProvider(orgId);
}

/** The provider that drafts quotes from photos (lib/quoting.ts) — "Built-in" (the platform provider) if none is assigned. */
export async function quoteLlmProvider(orgId: string): Promise<LlmProvider | null> {
  const row = await queryOne<ProviderRow>(
    `SELECT ${SELECT_COLUMNS} FROM llm_providers WHERE org_id = $1 AND is_quote_provider AND is_enabled`,
    [orgId],
  );
  if (row) return toProvider(row);
  return builtInProvider(orgId);
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

/**
 * Assigns exactly this provider (and, optionally, a specific model of its
 * own to use instead of that provider's general default) to analyze email —
 * same one-statement pattern as `setDefaultLlmProvider`. `id: null` clears
 * the assignment entirely — the "Built-in" choice in the Email section on
 * /settings, i.e. Clandar's platform provider (see builtInProvider).
 */
export async function setEmailAnalyzerProvider(id: string | null, model: string | null, orgId: string) {
  await query(
    `UPDATE llm_providers
        SET is_email_analyzer = coalesce(id = $1, false),
            email_model = CASE WHEN id = $1 THEN $2 ELSE email_model END
      WHERE org_id = $3`,
    [id, model, orgId],
  );
}

/**
 * Assigns exactly this provider (and, optionally, a specific model override)
 * to the Executive Assistant chat — same one-statement pattern as
 * `setDefaultLlmProvider`. `id: null` clears the assignment — the "Built-in"
 * choice in the Chat section on /settings (Clandar's platform provider).
 */
export async function setChatProvider(id: string | null, model: string | null, orgId: string) {
  await query(
    `UPDATE llm_providers
        SET is_chat_provider = coalesce(id = $1, false),
            chat_model = CASE WHEN id = $1 THEN $2 ELSE chat_model END
      WHERE org_id = $3`,
    [id, model, orgId],
  );
}

/** Assigns the invoice/receipt reader (and optional model); `id: null` = Built-in. Same pattern as setChatProvider. */
export async function setInvoiceProvider(id: string | null, model: string | null, orgId: string) {
  await query(
    `UPDATE llm_providers
        SET is_invoice_provider = coalesce(id = $1, false),
            invoice_model = CASE WHEN id = $1 THEN $2 ELSE invoice_model END
      WHERE org_id = $3`,
    [id, model, orgId],
  );
}

/** Assigns the quote drafter (and optional model); `id: null` = Built-in. Same pattern as setChatProvider. */
export async function setQuoteProvider(id: string | null, model: string | null, orgId: string) {
  await query(
    `UPDATE llm_providers
        SET is_quote_provider = coalesce(id = $1, false),
            quote_model = CASE WHEN id = $1 THEN $2 ELSE quote_model END
      WHERE org_id = $3`,
    [id, model, orgId],
  );
}

export async function setLlmProviderEnabled(id: string, orgId: string, enabled: boolean) {
  await query(
    `UPDATE llm_providers
        SET is_enabled = $3,
            is_default = is_default AND $3,
            is_email_analyzer = is_email_analyzer AND $3,
            is_chat_provider = is_chat_provider AND $3,
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
  const cipher = row ? row.api_key_cipher : (await platformProviderSecret(id))?.apiKeyCipher;
  if (!cipher) return {};
  return { Authorization: `Bearer ${decryptSecret(cipher)}` };
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
  options: { temperature?: number; timeoutMs?: number; model?: string } = {},
): Promise<string> {
  const provider = await getLlmProvider(providerId);
  if (!provider) throw new Error("LLM provider not found");
  const model = options.model || provider.model;
  if (!model) throw new Error(`${provider.name} has no model selected — test it on /settings first`);

  const baseUrl = trimTrailingSlash(provider.baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders(providerId)) },
    body: JSON.stringify({
      model,
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

/* ── Native tool calling ──────────────────────────────────── */

/** A tool offered to the model — OpenAI-style function with a JSON Schema for its arguments. */
export type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };

/** A tool call the model made: `arguments` is the raw JSON string it produced. */
export type ModelToolCall = { id: string; name: string; arguments: string };

/** The conversation as the tool-calling API sees it: plus the assistant's tool calls and each tool's result. */
export type ToolChatMessage =
  | ChatMessage
  | {
      role: "assistant";
      content: string | null;
      tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_calls"; calls: ModelToolCall[] }
  | { type: "finish"; reason: string | null };

/**
 * A streamed chat completion with native tool calling (the OpenAI-compatible
 * `tools` parameter). Reply text is yielded token by token as the model writes
 * it; tool calls are assembled from their streamed fragments and yielded once
 * complete. The provider's SSE is parsed with eventsource-parser.
 */
export async function* chatStreamWithTools(
  providerId: string,
  messages: ToolChatMessage[],
  tools: ToolDefinition[],
  options: { temperature?: number; timeoutMs?: number; model?: string } = {},
): AsyncGenerator<ToolStreamEvent> {
  const provider = await getLlmProvider(providerId);
  if (!provider) throw new Error("LLM provider not found");
  const model = options.model || provider.model;
  if (!model) throw new Error(`${provider.name} has no model selected — test it on /settings first`);

  const baseUrl = trimTrailingSlash(provider.baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders(providerId)) },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0,
      stream: true,
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: "auto",
          }
        : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  }).catch((error: unknown) => {
    throw new Error(`Could not reach ${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`);
  });
  if (!response.ok || !response.body) {
    throw new Error(`${provider.name} chat completion failed: ${await describeFailure(null, response, baseUrl)}`);
  }

  // Parsed frames are queued by the parser callback and drained by the generator between reads.
  const queue: ToolStreamEvent[] = [];
  const calls = new Map<number, ModelToolCall>();
  let finishReason: string | null = null;
  let sawAny = false;
  const parser = createParser({
    onEvent: (message) => {
      if (message.data === "[DONE]") return;
      let chunk: {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
      };
      try {
        chunk = JSON.parse(message.data);
      } catch {
        return;
      }
      const choice = chunk.choices?.[0];
      if (!choice) return;
      if (choice.delta?.content) {
        sawAny = true;
        queue.push({ type: "text", text: choice.delta.content });
      }
      for (const part of choice.delta?.tool_calls ?? []) {
        sawAny = true;
        const index = part.index ?? 0;
        const call = calls.get(index) ?? { id: "", name: "", arguments: "" };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
        calls.set(index, call);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
    while (queue.length) yield queue.shift()!;
  }
  while (queue.length) yield queue.shift()!;

  if (calls.size > 0) {
    yield {
      type: "tool_calls",
      calls: [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.arguments || "{}" })),
    };
  }
  if (!sawAny) throw new Error(`${provider.name} returned no completion content`);
  yield { type: "finish", reason: finishReason };
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
