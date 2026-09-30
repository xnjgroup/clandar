import Link from "next/link";
import { Icon } from "@/components/icons";
import {
  Card,
  CardTitle,
  EmptyRow,
  IconTile,
  PageBody,
  Pill,
  TableCard,
  TableHeader,
  TableTitle,
} from "@/components/ui";
import { count, firstParam, relativeTime, type Tone } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { hasGmailModifyScope, listGmailConnectors } from "@/lib/connectors";
import { fileSize, labelCounts } from "@/lib/gmail";
import {
  cleanupCounts,
  latestScan,
  listCleanupCandidates,
  SCAN_LABELS,
  type CleanupCandidate,
} from "@/lib/gmail-cleanup";
import { jobStatus } from "@/lib/queue";
import { dismissSelected, startInboxScan, trashSelected } from "./actions";
import { LabelDashboard } from "../label-dashboard";
import { ScanProgressPanel } from "./scan-progress-panel";

const CONFIDENCE_TONE: Record<CleanupCandidate["confidence"], Tone> = {
  high: "bad",
  medium: "warn",
  low: "idle",
};

export default async function EmailCleanupPage({ searchParams }: PageProps<"/email/cleanup">) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const { org } = await requireSession();

  const accounts = await listGmailConnectors(org.id);
  if (accounts.length === 0) {
    return (
      <PageBody>
        <Card className="flex flex-col items-center gap-[10px] py-9 text-center">
          <CardTitle>Gmail is not connected</CardTitle>
          <span className="max-w-[460px] text-[12.5px] leading-[1.55] text-muted">
            Connect a Gmail account first — cleanup analyzes and lets you trash low-value mail
            from any account you connect.
          </span>
          <Link
            href="/connectors"
            className="mt-1 rounded-full bg-ink px-[18px] py-[9px] text-[12.5px] font-semibold text-bg"
          >
            Open connectors
          </Link>
        </Card>
      </PageBody>
    );
  }

  const requestedId = firstParam(params.account);
  const account =
    accounts.find((a) => a.id === requestedId) ?? accounts.find((a) => a.status === "connected") ?? accounts[0];

  const [scan, candidates, counts, labels] = await Promise.all([
    latestScan(account.id),
    listCleanupCandidates(account.id, "pending"),
    cleanupCounts(account.id),
    labelCounts(org.id, account.id).catch(() => []), // the overview is a nice-to-have
  ]);

  const canTrash = hasGmailModifyScope(account);
  const scanning = scan?.status === "running";
  const scanJobStatus = scan?.jobId ? await jobStatus(scan.jobId) : null;

  return (
    <PageBody>
      {labels.length > 0 ? (
        <div className="flex flex-col gap-[8px]">
          <span className="text-[12px] font-medium text-muted">Your Gmail labels — open one to review or trash it in bulk</span>
          <LabelDashboard labels={labels} accounts={accounts.length} accountId={account.id} params={{}} />
        </div>
      ) : null}
      {notice ? (
        <p className="m-0 rounded-[14px] border border-line bg-surface px-[14px] py-[11px] text-[12.5px]">
          {notice}
        </p>
      ) : null}

      {accounts.length > 1 ? (
        <div className="flex flex-wrap gap-[7px]">
          {accounts.map((a) => (
            <Link
              key={a.id}
              href={`/email/cleanup?account=${a.id}`}
              className={`rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
                a.id === account.id ? "bg-ink text-bg" : "border border-line bg-surface text-body"
              }`}
            >
              {a.accountLabel ?? a.name}
            </Link>
          ))}
        </div>
      ) : null}

      <Card className="flex flex-col gap-[13px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <CardTitle>Inbox cleanup — {account.accountLabel ?? account.name}</CardTitle>
          <span className="text-[11.5px] text-muted">
            Heuristics find old, promotional-looking mail; the assigned analyzer model reviews
            each one before it&rsquo;s ever suggested
          </span>
          <form action={startInboxScan} className="ml-auto flex shrink-0 items-center gap-[8px]">
            <input type="hidden" name="connectorId" value={account.id} />
            <select
              name="label"
              disabled={scanning}
              defaultValue=""
              className="rounded-[10px] border border-line bg-surface px-2 py-[8px] text-[12.5px] text-ink"
            >
              <option value="">Whole inbox</option>
              {SCAN_LABELS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} only
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={scanning}
              className="rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-50"
            >
              {scanning ? "Analyzing…" : "Analyze inbox"}
            </button>
          </form>
        </div>

        {!canTrash ? (
          <p className="m-0 rounded-[12px] bg-warn-bg px-3 py-2 text-[12px] leading-[1.6] text-warn-fg">
            {account.name} was connected before cleanup existed and only has read access.{" "}
            <Link href="/connectors" className="underline">
              Reconnect it
            </Link>{" "}
            to grant permission to trash messages — analysis still works without it.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-[14px] text-[12px] text-muted">
          {scanning && scan?.jobId ? (
            <ScanProgressPanel
              jobId={scan.jobId}
              initial={
                scanJobStatus ?? { state: "active", done: scan.messagesScanned, total: 0, error: null }
              }
            />
          ) : scanning ? (
            <span className="flex items-center gap-[6px]">
              <Icon name="refresh" size={14} className="shrink-0" />
              Scanning your inbox…
            </span>
          ) : scan ? (
            scan.status === "failed" ? (
              <span className="text-bad-fg">Last scan failed: {scan.errorDetail}</span>
            ) : (
              <span>
                Last scanned {relativeTime(scan.finishedAt ?? scan.startedAt)}
                {scan.label ? ` (${SCAN_LABELS.find((l) => l.id === scan.label)?.label ?? scan.label} only)` : ""} —
                checked {count(scan.messagesScanned)} messages, found {count(scan.candidatesFound)} candidate
                {scan.candidatesFound === 1 ? "" : "s"}
                {scan.analyzerProvider ? ` · reviewed by ${scan.analyzerProvider}` : " · heuristics only"}
              </span>
            )
          ) : (
            <span>Never scanned yet — Analyze inbox to find mail worth cleaning up.</span>
          )}
          <span className="ml-auto flex gap-[10px] font-mono text-[11px] text-faint">
            <span>{count(counts.pending)} pending</span>
            <span>{count(counts.trashed)} trashed</span>
            <span>{count(counts.dismissed)} dismissed</span>
          </span>
        </div>
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Candidates to review</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">{count(candidates.length)} pending</span>
        </TableHeader>

        {candidates.length === 0 ? (
          <EmptyRow>
            {scan
              ? "Nothing waiting for review — run another scan any time to check for more."
              : "Run a scan to see what this account has worth cleaning up."}
          </EmptyRow>
        ) : (
          <form id="cleanup-bulk" className="flex flex-col">
            {candidates.map((c) => (
              <label
                key={c.id}
                className="flex min-w-0 flex-wrap items-start gap-3 border-t border-line-soft px-[18px] py-[13px]"
              >
                <input
                  type="checkbox"
                  name="candidateId"
                  value={c.id}
                  className="mt-[3px] size-[15px] shrink-0 cursor-pointer accent-ink"
                />
                <IconTile icon="mail" bg="#f2f4ef" fg="#4c4f47" />
                <div className="flex min-w-0 flex-1 flex-col gap-[3px] leading-[1.35]">
                  <span className="flex min-w-0 items-baseline gap-[9px]">
                    <span className="truncate text-[13px] font-semibold">{c.subject}</span>
                    <Pill tone={CONFIDENCE_TONE[c.confidence]}>{c.confidence} confidence</Pill>
                  </span>
                  <span className="truncate text-[11px] text-muted">{c.from}</span>
                  <span className="text-[11.5px] leading-[1.5] text-body-soft">
                    {c.llmReason ?? c.reason}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {c.receivedAt ? relativeTime(c.receivedAt) : "—"}
                  {c.sizeEstimate > 0 ? ` · ${fileSize(c.sizeEstimate)}` : ""}
                </span>
              </label>
            ))}
          </form>
        )}

        {candidates.length > 0 ? (
          <div className="flex flex-wrap items-center gap-[10px] border-t border-line-soft px-[18px] py-[13px]">
            <input type="hidden" name="connectorId" value={account.id} form="cleanup-bulk" />
            <span className="text-[11.5px] text-muted">Select messages above, then:</span>
            <button
              type="submit"
              form="cleanup-bulk"
              formAction={dismissSelected}
              className="cursor-pointer rounded-full border border-line px-[14px] py-[7px] text-[12px] font-medium"
            >
              Dismiss selected
            </button>
            <button
              type="submit"
              form="cleanup-bulk"
              formAction={trashSelected}
              disabled={!canTrash}
              title={canTrash ? undefined : "Reconnect this account to grant permission to trash mail"}
              className="rounded-full bg-bad-fg px-[14px] py-[7px] text-[12px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-40"
            >
              Move to Trash
            </button>
            <span className="text-[11px] text-faint">Trash is reversible for 30 days in Gmail.</span>
          </div>
        ) : null}
      </TableCard>
    </PageBody>
  );
}
