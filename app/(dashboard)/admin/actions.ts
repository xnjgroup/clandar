"use server";

import { revalidatePath } from "next/cache";
import { encryptionConfigured } from "@/lib/crypto";
import { requireAdmin } from "@/lib/admin";
import {
  createPlatformLlmProvider,
  deletePlatformLlmProvider,
  listPlatformLlmProviders,
  probePlatformLlmProvider,
  setPlatformDefaultLlmProvider,
  setPlatformLlmProviderEnabled,
  setPlatformLlmProviderModel,
} from "@/lib/platform-llm-providers";

const PATH = "/admin";

export type FormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function addPlatformProvider(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const name = field(form, "name");
  const baseUrl = field(form, "baseUrl");
  const apiKey = field(form, "apiKey");
  const makeDefault = field(form, "makeDefault") === "true";

  if (!name) return { error: "Give the provider a name." };

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { error: "Enter the API's base URL, for example https://api.openai.com/v1." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Only http:// and https:// URLs are supported." };
  }
  if (apiKey && !encryptionConfigured()) {
    return { error: "APP_ENCRYPTION_KEY is not set, so the API key cannot be stored. Add one to .env.local." };
  }

  const existing = await listPlatformLlmProviders();

  let id: string;
  try {
    id = await createPlatformLlmProvider({
      name,
      baseUrl: parsed.toString(),
      apiKey: apiKey || null,
      createdBy: session.person.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("platform_llm_providers_name_key")) {
      return { error: `A platform provider named “${name}” already exists.` };
    }
    return { error: message || "Could not save the provider." };
  }

  if (makeDefault || existing.length === 0) {
    await setPlatformDefaultLlmProvider(id);
  }

  const probe = await probePlatformLlmProvider(id);
  revalidatePath(PATH);
  return probe.ok
    ? { ok: `${name} connected — ${probe.message}.` }
    : { error: `${name} was saved, but the test call failed: ${probe.message}` };
}

export async function testPlatformProvider(form: FormData) {
  await requireAdmin();
  await probePlatformLlmProvider(field(form, "id"));
  revalidatePath(PATH);
}

export async function setPlatformModel(form: FormData) {
  await requireAdmin();
  const model = field(form, "model");
  if (model) await setPlatformLlmProviderModel(field(form, "id"), model);
  revalidatePath(PATH);
}

export async function makePlatformDefault(form: FormData) {
  await requireAdmin();
  await setPlatformDefaultLlmProvider(field(form, "id"));
  revalidatePath(PATH);
}

export async function togglePlatformProvider(form: FormData) {
  await requireAdmin();
  await setPlatformLlmProviderEnabled(field(form, "id"), field(form, "enabled") === "true");
  revalidatePath(PATH);
}

export async function removePlatformProvider(form: FormData) {
  await requireAdmin();
  await deletePlatformLlmProvider(field(form, "id"));
  revalidatePath(PATH);
}
