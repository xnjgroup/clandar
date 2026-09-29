"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { encryptionConfigured } from "@/lib/crypto";
import {
  createMcpConnector,
  deleteConnector,
  getConnector,
  getConnectorForOrg,
  googleOAuthConfigured,
  isGoogleService,
  logConnectorEvent,
  probeConnector,
  probeMcpConnector,
  reauthorizeGoogleConnector,
  setConnectorEnabled,
  startGoogleAuth,
  type AuthType,
} from "@/lib/connectors";
import { requireSession } from "@/lib/auth";
import { originFromHeaders } from "@/lib/request-origin";

const PATH = "/connectors";

export type FormState = { error?: string; ok?: string };

const AUTH_TYPES: AuthType[] = ["none", "bearer", "api-key", "basic"];

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Adds any HTTP MCP server, then immediately runs the handshake against it. */
export async function addMcpServer(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const name = field(form, "name");
  const url = field(form, "url");
  const authType = field(form, "authType") as AuthType;
  const secret = field(form, "secret");
  const headerName = field(form, "headerName");

  if (!name) return { error: "Give the server a name." };
  if (!AUTH_TYPES.includes(authType)) return { error: "Pick an authentication type." };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Enter the server's full URL, for example https://example.com/mcp." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Only http:// and https:// URLs are supported." };
  }
  if (authType !== "none" && !secret) {
    return { error: "This authentication type needs a token, key or user:password." };
  }
  if (authType !== "none" && !encryptionConfigured()) {
    return {
      error: "APP_ENCRYPTION_KEY is not set, so credentials cannot be stored. Add one to .env.local.",
    };
  }

  let id: string;
  try {
    id = await createMcpConnector({
      orgId: session.org.id,
      name,
      url: parsed.toString(),
      authType,
      headerName: authType === "api-key" ? headerName || "X-API-Key" : null,
      secret: authType === "none" ? null : secret,
      createdBy: session.person.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("connectors_org_name_key")) {
      return { error: `A connector named “${name}” already exists.` };
    }
    return { error: message || "Could not save the connector." };
  }

  await logConnectorEvent(id, "created", true, `Added ${parsed.host}`);

  const connector = await getConnector(id);
  const probe = connector ? await probeMcpConnector(connector) : { ok: false, message: "not found" };

  revalidatePath(PATH);
  return probe.ok
    ? { ok: `${name} connected — ${probe.message}.` }
    : { error: `${name} was saved, but the handshake failed: ${probe.message}` };
}

export async function checkConnector(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const connector = await getConnectorForOrg(id, org.id);
  if (connector) await probeConnector(connector);
  revalidatePath(PATH);
}

export async function toggleConnector(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const enabled = field(form, "enabled") === "true";
  await setConnectorEnabled(id, org.id, enabled);
  await logConnectorEvent(id, "updated", true, enabled ? "Enabled" : "Disabled");
  revalidatePath(PATH);
}

export async function removeConnector(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await deleteConnector(id, org.id);
  revalidatePath(PATH);
}

/**
 * Sends the browser to Google's consent screen to connect another Gmail or
 * Calendar account — always adds a new one, so more than one can be connected.
 */
export async function connectGoogle(form: FormData) {
  const session = await requireSession();
  const service = field(form, "service");
  if (!isGoogleService(service)) return;
  if (!googleOAuthConfigured()) {
    redirect(
      `${PATH}?notice=${encodeURIComponent("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.")}`,
    );
  }
  const origin = originFromHeaders(await headers());
  const url = await startGoogleAuth(service, session.org.id, session.person.id, origin);
  redirect(url);
}

/** Re-runs consent for one already-connected Google account — for an expired token. */
export async function reconnectGoogle(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  if (!googleOAuthConfigured()) {
    redirect(
      `${PATH}?notice=${encodeURIComponent("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.")}`,
    );
  }
  const origin = originFromHeaders(await headers());
  const url = await reauthorizeGoogleConnector(id, org.id, origin);
  redirect(url);
}
