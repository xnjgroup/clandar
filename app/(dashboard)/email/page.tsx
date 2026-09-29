import Link from "next/link";
import { Icon } from "@/components/icons";
import { TabLinks } from "@/components/tabs";
import {
  Card,
  CardTitle,
  EmptyRow,
  IconTile,
  PageBody,
  Pager,
  SearchForm,
  TableCard,
  TableHeader,
  TableTitle,
} from "@/components/ui";
import { count, firstParam, hrefWith, relativeTime } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { hasGmailModifyScope, listGmailConnectors, type Connector } from "@/lib/connectors";
import { BULK_TRASH_LABELS } from "@/lib/gmail-cleanup";
import {
  GmailError,
  LABEL_QUERIES,
  DEFAULT_MAILBOX_VIEW,
  MAILBOX_VIEWS,
  labelCounts,
  listMail,
  mailboxView,
  type LabelCount,
} from "@/lib/gmail";
import { bulkTrashJobId, bulkTrashStatus } from "@/lib/queue";
import { TrashLabelButton } from "./trash-label-button";
import { TrashProgressPanel } from "./trash-progress-panel";

/** Which labels get a "Trash all X" button, and where — matches BULK_TRASH_LABELS' ids. */
const QUICK_TRASH_LABELS = ["SPAM", "CATEGORY_PROMOTIONS"];

function LabelDashboard({
  labels,
  accounts,
  accountId,
  params,
}: {
  labels: LabelCount[];
  accounts: number;
  accountId: string;
  params: Record<string, string | string[] | undefined>;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-[8px]">
      {labels.map((l) => (
        <Link
          key={l.id}
          href={hrefWith(PATH, params, {
            view: "all",
            q: LABEL_QUERIES[l.id],
            account: accounts > 1 ? accountId : null,
            t: null,
          })}
          className="flex shrink-0 items-center gap-[7px] rounded-[12px] border border-line bg-surface px-[11px] py-[8px] hover:bg-[#fafbf9]"
        >
          <span className="text-[11.5px] text-muted">{l.label}</span>
          <span className="font-mono text-[12.5px] font-semibold">{count(l.total)}</span>
          {l.unread > 0 ? (
            <span className="rounded-full bg-ok-bg px-[6px] py-[1px] font-mono text-[10px] text-ok-fg">
              {count(l.unread)} new
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

const PAGE_SIZE = 25;
const PATH = "/email";

/** Not connected yet, or the token went stale — both end at /connectors. */
function NotConnected({ title, detail }: { title: string; detail: string }) {
  return (
    <Card className="flex flex-col items-center gap-[10px] py-9 text-center">
      <span className="flex size-[42px] items-center justify-center rounded-[13px] bg-warn-bg text-warn-fg">
        <Icon name="mail" size={21} />
      </span>
      <CardTitle>{title}</CardTitle>
      <span className="max-w-[460px] text-[12.5px] leading-[1.55] text-muted">{detail}</span>
      <Link
        href="/connectors"
        className="mt-1 rounded-full bg-ink px-[18px] py-[9px] text-[12.5px] font-semibold text-bg"
      >
        Open connectors
      </Link>
    </Card>
  );
}

/** Short label for the account switcher: the address if known, else the row's name. */
function accountLabel(account: Connector) {
  return account.accountLabel ?? account.name;
}

export default async function EmailPage({ searchParams }: PageProps<"/email">) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const view = mailboxView(firstParam(params.view));
  const search = firstParam(params.q);
  // The quick-trash label the current search exactly matches, if any — decides
  // which "Trash all X" button (if any) shows in the table header.
  const viewingLabel = QUICK_TRASH_LABELS.find(
    (id) => search.trim().toLowerCase() === LABEL_QUERIES[id],
  );
  // Gmail pages with opaque tokens, so the trail of visited pages lives in the
  // URL — the last entry is this page, dropping it goes back.
  const trail = firstParam(params.t).split(",").filter(Boolean);
  const { org } = await requireSession();

  const accounts = await listGmailConnectors(org.id);
  if (accounts.length === 0) {
    return (
      <PageBody>
        <NotConnected
          title="Gmail is not connected"
          detail="Connect a Google account on the connectors page to read invoices and receipts from your inbox here. You can connect more than one."
        />
      </PageBody>
    );
  }

  // Prefer whichever account is named in the URL; otherwise the first one that
  // actually works, so one broken account doesn't block the others.
  const requestedId = firstParam(params.account);
  const account =
    accounts.find((a) => a.id === requestedId) ??
    accounts.find((a) => a.status === "connected") ??
    accounts[0];

  if (account.status !== "connected") {
    return (
      <PageBody>
        <NotConnected
          title={`${account.name} needs authorizing`}
          detail={
            account.statusDetail
              ? `The last attempt reported: ${account.statusDetail}`
              : "Finish Google's consent screen to give this dashboard read-only access."
          }
        />
      </PageBody>
    );
  }

  let mailbox;
  let labels: LabelCount[] = [];
  let trashJobs: (Awaited<ReturnType<typeof bulkTrashStatus>>)[] = [];
  try {
    [mailbox, labels, trashJobs] = await Promise.all([
      listMail({
        orgId: org.id,
        connectorId: account.id,
        query: view.query,
        search,
        pageToken: trail.at(-1),
        pageSize: PAGE_SIZE,
      }),
      labelCounts(org.id, account.id).catch(() => []), // the dashboard is a nice-to-have, not worth failing the page over
      // Checked regardless of which view is open — a bulk trash keeps running
      // in the background no matter where you navigate within /email.
      Promise.all(QUICK_TRASH_LABELS.map((id) => bulkTrashStatus(account.id, id))),
    ]);
  } catch (error) {
    const gmail = error instanceof GmailError ? error : null;
    return (
      <PageBody>
        <NotConnected
          title="Could not read the mailbox"
          detail={`${gmail?.message ?? "Unexpected error"}${
            gmail?.reconnect ? " — reconnect the Gmail connector and try again." : ""
          }`}
        />
      </PageBody>
    );
  }

  const prevTrail = trail.slice(0, -1);
  const prevHref = trail.length > 0 ? hrefWith(PATH, params, { t: prevTrail.join(",") || null }) : null;
  const nextHref = mailbox.nextPageToken
    ? hrefWith(PATH, params, { t: [...trail, mailbox.nextPageToken].join(",") })
    : null;

  const messageHref = (id: string) =>
    hrefWith(`${PATH}/${id}`, {}, {
      view: view.id === DEFAULT_MAILBOX_VIEW ? null : view.id,
      q: search || null,
      account: accounts.length > 1 ? account.id : null,
    });

  return (
    <PageBody>
      {notice ? (
        <p className="m-0 rounded-[14px] border border-line bg-surface px-[14px] py-[11px] text-[12.5px]">
          {notice}
        </p>
      ) : null}

      {QUICK_TRASH_LABELS.map((id, i) => {
        const status = trashJobs[i];
        if (!status) return null;
        const name = BULK_TRASH_LABELS.find((l) => l.id === id)?.label ?? id;
        return (
          <TrashProgressPanel
            key={id}
            jobId={bulkTrashJobId(account.id, id)}
            labelName={name}
            initial={status}
          />
        );
      })}

      <div className="flex flex-wrap items-center gap-[9px]">
        <SearchForm
          action={PATH}
          placeholder="Gmail search — from:acme has:attachment…"
          defaultValue={search}
          keep={{
            view: view.id === DEFAULT_MAILBOX_VIEW ? undefined : view.id,
            account: accounts.length > 1 ? account.id : undefined,
          }}
          className="max-w-[360px] flex-1"
        />
        {accounts.length === 1 ? (
          <span className="flex shrink-0 items-center gap-2 rounded-[14px] border border-line bg-surface px-[13px] py-[9px]">
            <Icon name="mail" size={16} className="shrink-0 text-body-soft" />
            <span className="truncate text-[12.5px] font-medium">{accountLabel(account)}</span>
          </span>
        ) : null}
        <Link
          href={`/email/cleanup?account=${account.id}`}
          className="flex shrink-0 items-center gap-2 rounded-[14px] border border-line bg-surface px-[13px] py-[9px] text-[12.5px] font-medium"
        >
          <Icon name="shield" size={15} className="shrink-0 text-body-soft" />
          Clean up inbox
        </Link>
      </div>

      {accounts.length > 1 ? (
        <TabLinks
          options={accounts.map(accountLabel)}
          value={accountLabel(account)}
          label="Gmail account"
          href={(label) => {
            const target = accounts.find((a) => accountLabel(a) === label)!;
            return hrefWith(PATH, params, { account: target.id, t: null });
          }}
        />
      ) : null}

      {labels.length > 0 ? (
        <LabelDashboard labels={labels} accounts={accounts.length} accountId={account.id} params={params} />
      ) : null}

      <TabLinks
        options={MAILBOX_VIEWS.map((v) => v.label)}
        value={view.label}
        label="Mailbox view"
        href={(label) => {
          const target = MAILBOX_VIEWS.find((v) => v.label === label)!;
          return hrefWith(PATH, params, {
            view: target.id === DEFAULT_MAILBOX_VIEW ? null : target.id,
            t: null,
          });
        }}
      />

      <TableCard>
        <TableHeader>
          <TableTitle>{search ? `Messages matching “${search}”` : view.label}</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {mailbox.messages.length === 0
              ? "no messages"
              : `${count(mailbox.messages.length)} shown · ~${count(mailbox.estimate)} match`}
          </span>
          {viewingLabel ? (
            <TrashLabelButton
              connectorId={account.id}
              label={viewingLabel}
              labelName={BULK_TRASH_LABELS.find((l) => l.id === viewingLabel)?.label ?? viewingLabel}
              count={labels.find((l) => l.id === viewingLabel)?.total ?? 0}
              disabled={!hasGmailModifyScope(account)}
              disabledReason="Reconnect this account on /connectors to grant permission to trash mail"
            />
          ) : (
            <span className="ml-auto text-[11px] text-faint">read-only access</span>
          )}
        </TableHeader>

        {mailbox.messages.length === 0 ? (
          <EmptyRow>
            {search
              ? `Nothing in this mailbox matched “${search}”.`
              : "No messages in this view."}
          </EmptyRow>
        ) : (
          mailbox.messages.map((message) => (
            <Link
              key={message.id}
              href={messageHref(message.id)}
              className="flex min-h-[64px] min-w-0 items-center gap-3 border-t border-line-soft px-[18px] py-[11px] hover:bg-[#fafbf9]"
            >
              <IconTile
                icon={message.unread ? "mail" : "doc"}
                bg={message.unread ? "#eaf3d8" : "#f2f4ef"}
                fg={message.unread ? "#41631a" : "#4c4f47"}
              />
              <div className="flex min-w-0 flex-1 flex-col leading-[1.4]">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={`truncate text-[13px] ${
                      message.unread ? "font-bold" : "font-semibold"
                    }`}
                  >
                    {message.from}
                  </span>
                  {message.starred ? (
                    <Icon name="alertSm" size={12} className="shrink-0 text-warn-fg" />
                  ) : null}
                </span>
                <span className="truncate text-[12.5px] text-body">{message.subject}</span>
                <span className="truncate text-[11px] text-muted">{message.snippet}</span>
              </div>
              <span className="ml-2 shrink-0 font-mono text-[11px] text-faint">
                {relativeTime(message.date)}
              </span>
            </Link>
          ))
        )}

        <Pager
          label={
            trail.length === 0
              ? `First ${count(mailbox.messages.length)}`
              : `Page ${trail.length + 1}`
          }
          prevHref={prevHref}
          nextHref={nextHref}
        />
      </TableCard>
    </PageBody>
  );
}
