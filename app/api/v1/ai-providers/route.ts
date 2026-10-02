import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { encryptionConfigured } from "@/lib/crypto";
import { createLlmProvider, listLlmProviders, probeLlmProvider, setDefaultLlmProvider } from "@/lib/llm-providers";
import { aiProvidersResponse } from "@/lib/ai-providers-json";

/**
 * GET → { providers, features } — the org's OpenAI-compatible providers (never their keys) and which
 * one each feature uses (null = Built-in, Clandar AI). Same as Settings → LLM providers on the website.
 */
export const GET = api(async () => {
  const { org } = await apiSession();
  return NextResponse.json(await aiProvidersResponse(org.id));
});

/**
 * POST { name, baseUrl, apiKey?, makeDefault? } — adds a provider and lists its models right away →
 * { ok, message, providers, features }. The first one added becomes the default.
 */
export const POST = api(async (request: Request) => {
  const session = await apiSession();
  const body = await jsonBody<{ name?: string; baseUrl?: string; apiKey?: string; makeDefault?: boolean }>(request);
  const name = body.name?.trim() ?? "";
  const baseUrl = body.baseUrl?.trim() ?? "";
  const apiKey = body.apiKey?.trim() ?? "";
  if (!name) throw new ApiError(400, "Give the provider a name.");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ApiError(400, "Enter the API's base URL, for example https://api.openai.com/v1.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new ApiError(400, "Only http:// and https:// URLs are supported.");
  if (apiKey && !encryptionConfigured()) throw new ApiError(503, "API keys can't be stored on this server (APP_ENCRYPTION_KEY is not set).");

  const existing = await listLlmProviders(session.org.id);
  let id: string;
  try {
    id = await createLlmProvider({ orgId: session.org.id, name, baseUrl: parsed.toString(), apiKey: apiKey || null, createdBy: session.person.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("llm_providers_org_name_key")) throw new ApiError(400, `A provider named “${name}” already exists.`);
    throw error;
  }
  if (body.makeDefault || existing.length === 0) await setDefaultLlmProvider(id, session.org.id);
  const probe = await probeLlmProvider(id, session.org.id);
  return NextResponse.json({
    ok: probe.ok,
    message: probe.ok ? `${name} connected — ${probe.message}.` : `${name} was saved, but the test call failed: ${probe.message}`,
    ...(await aiProvidersResponse(session.org.id)),
  });
});
