import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { aiProvidersResponse } from "@/lib/ai-providers-json";
import {
  deleteLlmProvider,
  getLlmProviderForOrg,
  setDefaultLlmProvider,
  setLlmProviderEnabled,
  setLlmProviderModel,
} from "@/lib/llm-providers";

type Context = { params: Promise<{ id: string }> };

/** PATCH { model?, makeDefault?, enabled? } → { providers, features }. */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Provider");
  const provider = await getLlmProviderForOrg(id, org.id);
  if (!provider) throw new ApiError(404, "Provider not found.");
  const body = await jsonBody<{ model?: string; makeDefault?: boolean; enabled?: boolean }>(request);
  if (typeof body.model === "string" && body.model.trim()) await setLlmProviderModel(id, org.id, body.model.trim());
  if (body.makeDefault === true) await setDefaultLlmProvider(id, org.id);
  if (typeof body.enabled === "boolean") await setLlmProviderEnabled(id, org.id, body.enabled);
  return NextResponse.json(await aiProvidersResponse(org.id));
});

/** DELETE → { providers, features }. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Provider");
  await deleteLlmProvider(id, org.id);
  return NextResponse.json(await aiProvidersResponse(org.id));
});
