import { NextResponse, type NextRequest } from "next/server";
import {
  completeGoogleAuth,
  consumeOAuthState,
  googleRedirectUri,
  logConnectorEvent,
} from "@/lib/connectors";
import { originFromHeaders } from "@/lib/request-origin";

/**
 * Where Google sends the browser after consent. The `state` we stored maps back
 * to the connector row (and the exact redirect URI the auth request used); the
 * code is exchanged for tokens server-side and never reaches the client.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code");
  const error = params.get("error");

  const consumed = state ? await consumeOAuthState(state) : null;
  const back = (message: string) =>
    NextResponse.redirect(new URL(`/connectors?notice=${encodeURIComponent(message)}`, request.url));

  if (error) {
    if (consumed) {
      await logConnectorEvent(consumed.connectorId, "auth", false, `Google returned "${error}"`);
    }
    return back(`Google declined the connection: ${error}`);
  }
  if (!consumed) {
    return back("That authorization link expired — start the connection again.");
  }
  if (!code) {
    return back("Google did not return an authorization code.");
  }

  const { connectorId, redirectUri } = consumed;
  try {
    await completeGoogleAuth(
      connectorId,
      code,
      // A state row from before redirect_uri was tracked has none stored —
      // fall back to deriving it the same way the auth request would have.
      redirectUri ?? googleRedirectUri(originFromHeaders(request.headers)),
    );
    return back("Connected.");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    await logConnectorEvent(connectorId, "auth", false, message);
    return back(`Could not finish the connection: ${message}`);
  }
}
