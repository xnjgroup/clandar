import { NextResponse } from "next/server";
import { api, apiSession } from "@/lib/api";
import { gmailFailure, resolveAccount } from "@/lib/api-email";
import { labelCounts, listMail, listUserLabels, MAILBOX_VIEWS, mailboxView } from "@/lib/gmail";

/**
 * GET ?account=&view=inbox|bills|unread|attachments|all &label=LABEL_ID &q=search &pageToken=
 * → { account, messages, nextPageToken, estimate, views, labels (with counts), userLabels }.
 * A label wins over a view; q adds a Gmail search.
 */
export const GET = api(async (request: Request) => {
  const { org } = await apiSession();
  const params = new URL(request.url).searchParams;
  const account = await resolveAccount(org.id, params.get("account"));
  const label = params.get("label") ?? "";
  const view = mailboxView(params.get("view") ?? "inbox");
  try {
    const [mailbox, labels, userLabels] = await Promise.all([
      listMail({
        orgId: org.id,
        connectorId: account.id,
        query: label ? "" : view.query,
        labelId: label || undefined,
        search: params.get("q") ?? undefined,
        pageToken: params.get("pageToken") ?? undefined,
        pageSize: 30,
      }),
      labelCounts(org.id, account.id).catch(() => []),
      listUserLabels(org.id, account.id).catch(() => []),
    ]);
    return NextResponse.json({
      account: { id: account.id, label: account.accountLabel ?? account.name },
      messages: mailbox.messages,
      nextPageToken: mailbox.nextPageToken,
      estimate: mailbox.estimate,
      views: MAILBOX_VIEWS.map(({ id, label }) => ({ id, label })),
      labels,
      userLabels,
    });
  } catch (error) {
    gmailFailure(error);
  }
});
