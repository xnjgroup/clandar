import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { aiProvidersResponse } from "@/lib/ai-providers-json";
import { getLlmProviderForOrg, setChatProvider, setEmailAnalyzerProvider, setInvoiceProvider, setQuoteProvider } from "@/lib/llm-providers";

const SETTERS = {
  chat: setChatProvider,
  email: setEmailAnalyzerProvider,
  invoice: setInvoiceProvider,
  quote: setQuoteProvider,
} as const;

/**
 * PATCH { feature: chat|email|invoice|quote, providerId: id|null (Built-in), model: name|null (the
 * provider's default) } → { providers, features }.
 */
export const PATCH = api(async (request: Request) => {
  const { org } = await apiSession();
  const body = await jsonBody<{ feature?: string; providerId?: string | null; model?: string | null }>(request);
  const setter = SETTERS[body.feature as keyof typeof SETTERS];
  if (!setter) throw new ApiError(400, "Unknown feature.");
  const providerId = body.providerId || null;
  if (providerId && !(await getLlmProviderForOrg(providerId, org.id))) throw new ApiError(404, "Provider not found.");
  await setter(providerId, providerId ? body.model?.trim() || null : null, org.id);
  return NextResponse.json(await aiProvidersResponse(org.id));
});
