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
  setConnectorOAuth,
  setMcpDisabledTools,
  setMcpToolEnabled,
  startGoogleAuth,
  type AuthType,
} from "@/lib/connectors";
import { requireSession } from "@/lib/auth";
import { startMcpOAuth } from "@/lib/mcp-oauth";
import { originFromHeaders } from "@/lib/request-origin";

const PATH = "/connectors";

export type FormState = { error?: string; ok?: string };

const AUTH_TYPES: AuthType[] = ["none", "bearer", "api-key", "basic", "oauth2"];

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
  if (authType !== "none" && authType !== "oauth2" && !secret) {
    return { error: "This authentication type needs a token, key or user:password." };
  }
  if (authType !== "none" && authType !== "oauth2" && !encryptionConfigured()) {
    return {
      error: "APP_ENCRYPTION_KEY is not set, so credentials cannot be stored. Add one to .env.local.",
    };
  }

  let id: string;
  try {
    id = await createMcpConnector({
      orgId: session.org.id,
      name,
      // Exactly as typed — parsing only validates it; URL's normalizing would rewrite slashes etc.
      url,
      authType,
      headerName: authType === "api-key" ? headerName || "X-API-Key" : null,
      secret: authType === "none" || authType === "oauth2" ? null : secret,
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

  // OAuth sign-in: straight to the server's sign-in page.
  if (authType === "oauth2") {
    const signIn = await startSignIn(id, url, session.org.id);
    if (typeof signIn !== "string") return signIn;
    redirect(signIn);
  }

  const connector = await getConnector(id);
  const probe: { ok: boolean; message: string; unauthorized?: boolean } = connector
    ? await probeMcpConnector(connector)
    : { ok: false, message: "not found" };

  // Auto-discovery: a server added without auth that answers 401 and advertises OAuth → sign in.
  if (!probe.ok && probe.unauthorized && authType === "none") {
    const signIn = await startSignIn(id, url, session.org.id, { switchToOAuth: true });
    if (typeof signIn === "string") redirect(signIn);
  }

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

/**
 * Starts the OAuth sign-in for an MCP connector (discovery + registration by the SDK): returns where to
 * send the browser, or a form state when there's nothing to do / it failed.
 */
async function startSignIn(
  id: string,
  url: string,
  orgId: string,
  options: { switchToOAuth?: boolean } = {},
): Promise<string | FormState> {
  if (!encryptionConfigured()) return { error: "APP_ENCRYPTION_KEY is not set, so sign-in tokens cannot be stored." };
  try {
    if (options.switchToOAuth) await setConnectorOAuth(id, orgId);
    const target = await startMcpOAuth(id, url, originFromHeaders(await headers()));
    if (!target) {
      const connector = await getConnector(id);
      if (connector) await probeMcpConnector(connector);
      revalidatePath(PATH);
      return { ok: "Signed in." };
    }
    await logConnectorEvent(id, "auth", true, `Sign-in started at ${target.host}`);
    return target.toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await logConnectorEvent(id, "auth", false, message);
    revalidatePath(PATH);
    return { error: `Couldn't start the sign-in: ${message}` };
  }
}

/** "Sign in" on an MCP connector that uses OAuth (or answered 401 and supports it). */
export async function signInMcpConnector(form: FormData) {
  const { org } = await requireSession();
  const connector = await getConnectorForOrg(field(form, "id"), org.id);
  if (!connector || connector.kind !== "mcp" || !connector.url) return;
  const signIn = await startSignIn(connector.id, connector.url, org.id, { switchToOAuth: connector.authType !== "oauth2" });
  if (typeof signIn === "string") redirect(signIn);
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
