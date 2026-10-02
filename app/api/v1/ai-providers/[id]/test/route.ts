import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam } from "@/lib/api";
import { aiProvidersResponse } from "@/lib/ai-providers-json";
import { getLlmProviderForOrg, probeLlmProvider } from "@/lib/llm-providers";

type Context = { params: Promise<{ id: string }> };

/** POST → { ok, message, providers, features }: lists the endpoint's models again. */
export const POST = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Provider");
  if (!(await getLlmProviderForOrg(id, org.id))) throw new ApiError(404, "Provider not found.");
  const probe = await probeLlmProvider(id, org.id);
  return NextResponse.json({ ...probe, ...(await aiProvidersResponse(org.id)) });
});
