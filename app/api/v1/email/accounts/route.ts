import { NextResponse } from "next/server";
import { api, apiSession } from "@/lib/api";
import { hasGmailModifyScope, listGmailConnectors } from "@/lib/connectors";

/** GET → { accounts: [{ id, label, canTrash }] } — the connected Gmail accounts. */
export const GET = api(async () => {
  const { org } = await apiSession();
  const accounts = await listGmailConnectors(org.id);
  return NextResponse.json({
    accounts: accounts.map((a) => ({ id: a.id, label: a.accountLabel ?? a.name, canTrash: hasGmailModifyScope(a) })),
  });
});
