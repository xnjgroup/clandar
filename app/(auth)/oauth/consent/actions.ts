"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { checkAuthorizeRequest, createAuthCode } from "@/lib/mcp-server-auth";

/** "Allow" or "Don't allow" on the consent screen → back to the agent with a code (or an error). */
export async function decideAccess(form: FormData) {
  const session = await requireSession();
  const params = JSON.parse(String(form.get("params") ?? "{}")) as Record<string, string>;
  const checked = await checkAuthorizeRequest(params);
  if ("fatal" in checked) redirect("/overview");
  if ("redirect" in checked) redirect(checked.redirect);
  const { client, redirectUri, codeChallenge, state, resource } = checked.ok;
  const url = new URL(redirectUri);
  if (form.get("decision") === "allow") {
    url.searchParams.set(
      "code",
      await createAuthCode({ clientId: client.clientId, personId: session.person.id, orgId: session.org.id, redirectUri, codeChallenge, resource }),
    );
  } else {
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "The person didn't allow access.");
  }
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}
