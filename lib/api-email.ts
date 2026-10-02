import { ApiError } from "@/lib/api";
import { listGmailConnectors, type Connector } from "@/lib/connectors";
import { GmailError } from "@/lib/gmail";

/** The Gmail account a request is about: `account` if it's this org's, else the first connected one. */
export async function resolveAccount(orgId: string, account: string | null): Promise<Connector> {
  const accounts = await listGmailConnectors(orgId);
  if (accounts.length === 0) throw new ApiError(404, "No Gmail account is connected — connect one on the website (Connectors).");
  return accounts.find((a) => a.id === account) ?? accounts[0];
}

/** Gmail failures (expired access, rate limits) become a readable 502 instead of a 500. */
export function gmailFailure(error: unknown): never {
  if (error instanceof GmailError) {
    throw new ApiError(502, error.reconnect ? `${error.message} — reconnect it in Settings → Connectors (or Connectors on the website).` : error.message);
  }
  throw error;
}
