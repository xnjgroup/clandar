import Link from "next/link";
import { Icon } from "@/components/icons";
import { TabLinks } from "@/components/tabs";
import type { IconName } from "@/components/icons";
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
import { countOpenLeads, getLeadFinderSettings, listLeads } from "@/lib/lead-finder";
import { listProjectTypes } from "@/lib/project-types";
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
  listUserLabels,
  mailboxView,
  type LabelCount,
} from "@/lib/gmail";
import { bulkTrashJobId, bulkTrashStatus } from "@/lib/queue";
import { LeadsView } from "./leads-view";
import { MailboxNav, type MailboxNavHeading, type MailboxNavItem } from "./mailbox-nav";
import { TrashLabelButton } from "./trash-label-button";
import { TrashProgressPanel } from "./trash-progress-panel";

/** Which labels get a "Trash all X" button, and where — matches BULK_TRASH_LABELS' ids. */
const QUICK_TRASH_LABELS = ["SPAM", "CATEGORY_PROMOTIONS"];

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
  // A Gmail label opened from the side column (?view=label&label=<id>).
  const labelParam = firstParam(params.label);
  const viewingLabel = QUICK_TRASH_LABELS.find(
    (id) => labelParam === id || search.trim().toLowerCase() === LABEL_QUERIES[id],
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

  // Leads: the lead finder's review queue — opened by default once the finder is on (it's what matters most).
  const viewParam = firstParam(params.view);
  const [leadSettings, openLeads] = await Promise.all([getLeadFinderSettings(org.id), countOpenLeads(org.id)]);
  const showLeads = viewParam === "leads" || (!viewParam && !search && !labelParam && leadSettings.isEnabled);

  // Views: a left side column on desktop (like Gmail's), a sideways-scrolling chip row on phones.
  // Always explicit in links (?view=…), since the default depends on whether the lead finder is on.
  const VIEW_ICONS: Record<string, IconName> = {
    inbox: "mail",
    bills: "doc",
    unread: "message",
    attachments: "link2",
    all: "layers",
  };
  // Gmail's system labels (with counts) and the person's own labels, for the side column.
  const [systemLabels, userLabels] = await Promise.all([
    labelCounts(org.id, account.id).catch(() => [] as LabelCount[]),
    listUserLabels(org.id, account.id).catch(() => [] as { id: string; name: string }[]),
  ]);
  const totalOf = (id: string) => systemLabels.find((l) => l.id === id)?.total;
  const unreadOf = (id: string) => systemLabels.find((l) => l.id === id)?.unread;
  const LABEL_ICONS: Record<string, IconName> = {
    STARRED: "alertSm",
    CATEGORY_PROMOTIONS: "card",
    CATEGORY_SOCIAL: "users",
    CATEGORY_UPDATES: "refresh",
    CATEGORY_FORUMS: "chat",
    SPAM: "shield",
    TRASH: "close",
  };
  const labelHref = (id: string) =>
    hrefWith(PATH, {}, { view: "label", label: id, account: accounts.length > 1 ? account.id : null });
  const labelName =
    systemLabels.find((l) => l.id === labelParam)?.label ?? userLabels.find((l) => l.id === labelParam)?.name ?? labelParam;
  const navItems: (MailboxNavItem | MailboxNavHeading)[] = [
    {
      id: "leads",
      label: "Leads",
      icon: "briefcase",
      href: hrefWith(PATH, {}, { view: "leads", account: accounts.length > 1 ? account.id : null }),
      badge: openLeads,
    },
    ...MAILBOX_VIEWS.map((v) => ({
      id: v.id,
      label: v.label,
      icon: VIEW_ICONS[v.id] ?? "mail",
      href: hrefWith(PATH, {}, { view: v.id, account: accounts.length > 1 ? account.id : null }),
      count: v.id === "inbox" ? totalOf("INBOX") : v.id === "unread" ? totalOf("UNREAD") : undefined,
      unread: v.id === "inbox" ? unreadOf("INBOX") : v.id === "unread" ? totalOf("UNREAD") : undefined,
    })),
    { heading: "Labels" },
    ...systemLabels
      .filter((l) => l.id !== "INBOX" && l.id !== "UNREAD")
      .map((l) => ({
        id: `label:${l.id}`,
        label: l.label,
        icon: LABEL_ICONS[l.id] ?? "layers",
        href: labelHref(l.id),
        count: l.total,
        // Gmail's own convention: no unread badge on Spam/Trash.
        unread: l.id === "SPAM" || l.id === "TRASH" ? undefined : l.unread,
      })),
    ...userLabels.map((l) => ({ id: `label:${l.id}`, label: l.name, icon: "layers" as IconName, href: labelHref(l.id) })),
  ];
  const searchRow = (
    <div className="flex items-center gap-[9px]">
      <SearchForm
        action={PATH}
        placeholder="Search mail — from:acme has:attachment…"
        defaultValue={search}
        keep={{
          view: showLeads ? DEFAULT_MAILBOX_VIEW : view.id,
          account: accounts.length > 1 ? account.id : undefined,
        }}
        className="min-w-0 flex-1"
      />
      <Link
        href={`/email/cleanup?account=${account.id}`}
        className="flex shrink-0 items-center gap-2 rounded-[14px] border border-line bg-surface px-[13px] py-[9px] text-[12.5px] font-medium"
      >
        <Icon name="shield" size={15} className="shrink-0 text-body-soft" />
        Clean up
      </Link>
    </div>
  );
  /** Side column of views + the main column (search row, then the page's content). */
  const layout = (content: React.ReactNode) => (
    <div className="grid min-w-0 grid-cols-1 items-start gap-[12px] lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-[18px]">
      <MailboxNav items={navItems} active={labelParam ? `label:${labelParam}` : showLeads ? "leads" : view.id} />
      <div className="flex min-w-0 flex-col gap-[12px]">
        {searchRow}
        {accountSwitcher}
        {content}
      </div>
    </div>
  );

  const accountSwitcher =
    accounts.length > 1 ? (
      <TabLinks
        options={accounts.map(accountLabel)}
        value={accountLabel(account)}
        label="Gmail account"
        href={(label) => {
          const target = accounts.find((a) => accountLabel(a) === label)!;
          return hrefWith(PATH, params, { account: target.id, t: null });
        }}
      />
    ) : null;

  if (showLeads) {
    const handled = firstParam(params.handled) === "true";
    const typeFilter = firstParam(params.type);
    const [leads, projectTypes] = await Promise.all([
      listLeads(org.id, { handled, projectTypeId: typeFilter || undefined }),
      listProjectTypes(org.id),
    ]);
    return (
      <PageBody>
        {layout(
          <LeadsView
          leads={leads}
          settings={leadSettings}
          handled={handled}
          typeFilter={typeFilter}
          projectTypes={projectTypes}
          params={params}
            multipleAccounts={accounts.length > 1}
          />,
        )}
      </PageBody>
    );
  }

  let mailbox;
  let labelTotal = 0;
  let trashJobs: (Awaited<ReturnType<typeof bulkTrashStatus>>)[] = [];
  try {
    [mailbox, labelTotal, trashJobs] = await Promise.all([
      listMail({
        orgId: org.id,
        connectorId: account.id,
        query: labelParam ? "" : view.query,
        labelId: labelParam || undefined,
        search,
        pageToken: trail.at(-1),
        pageSize: PAGE_SIZE,
      }),
      // The label being viewed, for its "Trash all" button's count (already loaded for the side column).
      Promise.resolve(viewingLabel ? (totalOf(viewingLabel) ?? 0) : 0),
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
      view: labelParam ? "label" : view.id,
      label: labelParam || null,
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

      {layout(
      <TableCard>
        <TableHeader>
          <TableTitle>{search ? `Messages matching “${search}”` : labelParam ? labelName : view.label}</TableTitle>
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
              count={labelTotal}
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
      )}
    </PageBody>
  );
}
