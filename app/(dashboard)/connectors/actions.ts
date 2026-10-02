"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  deleteConnector,
  getConnectorForOrg,
  googleOAuthConfigured,
  isGoogleService,
  logConnectorEvent,
  probeConnector,
  probeMcpConnector,
  reauthorizeGoogleConnector,
  setConnectorEnabled,
  setMcpDisabledTools,
  setMcpToolEnabled,
  startGoogleAuth,
} from "@/lib/connectors";
import { requireSession } from "@/lib/auth";
import { addMcpServerFor, startMcpSignIn } from "@/lib/connector-setup";
import { originFromHeaders } from "@/lib/request-origin";

const PATH = "/connectors";

export type FormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Adds any HTTP MCP server, then immediately runs the handshake against it (lib/connector-setup.ts). */
export async function addMcpServer(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const result = await addMcpServerFor(
    { orgId: session.org.id, personId: session.person.id },
    {
      name: field(form, "name"),
      url: field(form, "url"),
      authType: field(form, "authType"),
      secret: field(form, "secret"),
      headerName: field(form, "headerName"),
    },
    originFromHeaders(await headers()),
  );
  if (result.signInUrl) redirect(result.signInUrl);
  revalidatePath(PATH);
  return { ok: result.ok, error: result.error };
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

/** "Sign in" on an MCP connector that uses OAuth (or answered 401 and supports it). */
export async function signInMcpConnector(form: FormData) {
  const { org } = await requireSession();
  const connector = await getConnectorForOrg(field(form, "id"), org.id);
  if (!connector || connector.kind !== "mcp" || !connector.url) return;
  const signIn = await startMcpSignIn(connector.id, connector.url, org.id, originFromHeaders(await headers()), {
    switchToOAuth: connector.authType !== "oauth2",
  });
  if (signIn.signInUrl) redirect(signIn.signInUrl);
  revalidatePath(PATH);
}

/** A tool chip on an MCP connector: switch that tool on or off for the assistant. */
export async function toggleMcpTool(form: FormData) {
  const { org } = await requireSession();
  await setMcpToolEnabled(field(form, "id"), org.id, field(form, "tool"), field(form, "enabled") === "true");
  revalidatePath(PATH);
}

/** The tools dialog's All on / All off: `disabled` is the full list of tools to switch off (JSON). */
export async function setMcpTools(form: FormData) {
  const { org } = await requireSession();
  let disabled: string[] = [];
  try {
    const parsed = JSON.parse(field(form, "disabled") || "[]");
    if (Array.isArray(parsed)) disabled = parsed.filter((t): t is string => typeof t === "string").slice(0, 500);
  } catch {
    return;
  }
  await setMcpDisabledTools(field(form, "id"), org.id, disabled);
  revalidatePath(PATH);
}

/** Refresh tools: asks the MCP server for its tool list again, and says what changed. */
export async function refreshMcpTools(id: string): Promise<{ ok: boolean; message: string }> {
  const { org } = await requireSession();
  const connector = await getConnectorForOrg(id, org.id);
  if (!connector || connector.kind !== "mcp") return { ok: false, message: "Connector not found." };
  const before = new Set(connector.tools.map((t) => t.name));
  const probe = await probeMcpConnector(connector);
  revalidatePath(PATH);
  if (!probe.ok) {
    return { ok: false, message: probe.unauthorized ? "The server needs you to sign in again." : `Couldn't reach the server: ${probe.message}` };
  }
  const after = (await getConnectorForOrg(id, org.id))?.tools.map((t) => t.name) ?? [];
  const added = after.filter((n) => !before.has(n)).length;
  const removed = [...before].filter((n) => !after.includes(n)).length;
  const changes = [added ? `${added} new` : "", removed ? `${removed} removed` : ""].filter(Boolean).join(", ");
  return { ok: true, message: `${after.length} tool${after.length === 1 ? "" : "s"}${changes ? ` — ${changes}` : " — no changes"}.` };
}
