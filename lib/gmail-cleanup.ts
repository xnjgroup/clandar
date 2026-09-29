/**
 * Runs a Gmail cleanup scan: `lib/cleanup-heuristics.ts` narrows an inbox down
 * to candidates for deletion, an optional LLM pass (the provider assigned on
 * /settings as the "email analyzer") writes a clearer reason for each and can
 * veto a false positive, and the results land in Postgres for /email/cleanup
 * to review.
 *
 * Nothing is ever deleted by this module on its own — `trashCandidates` only
 * runs when a person approves specific messages on the review screen, and it
 * calls Gmail's reversible `messages.trash`, never a permanent delete.
 */
import { getConnector, hasGmailModifyScope } from "@/lib/connectors";
import { classify, isEligible, type Confidence } from "@/lib/cleanup-heuristics";
import { query, queryOne } from "@/lib/db";
import { LABEL_QUERIES, labelCount, scanMail, trashMail, type ScannedMessage } from "@/lib/gmail";
import { chatComplete, emailAnalyzerProvider } from "@/lib/llm-providers";

/**
 * Messages newer than this never reach the heuristics — recent mail is far
 * more likely to still matter, and excluding it from the Gmail query keeps
 * the scan from spending API calls on messages that could never qualify.
 */
const BASE_SCAN_QUERY = "-in:trash -in:spam -is:starred -is:unread older_than:60d";
const LLM_BATCH_SIZE = 15;

/** What "Analyze inbox" can be scoped to — the whole inbox, or one label at a time. */
export const SCAN_LABELS: { id: string; label: string }[] = [
  { id: "CATEGORY_PROMOTIONS", label: "Promotions" },
  { id: "CATEGORY_SOCIAL", label: "Social" },
  { id: "CATEGORY_UPDATES", label: "Updates" },
  { id: "CATEGORY_FORUMS", label: "Forums" },
];

function scanQueryFor(label: string | null): string {
  const scopeQuery = label ? LABEL_QUERIES[label] : null;
  return scopeQuery ? `${BASE_SCAN_QUERY} ${scopeQuery}` : BASE_SCAN_QUERY;
}

/**
 * Labels where "Trash all X" makes sense as a direct, no-review bulk action —
 * Spam is Google's own conservative filter, and the categories are the same
 * ones the reviewed scan can target, just skipping straight to trashing all
 * of it. Deliberately excludes Inbox/Unread/Starred/Trash — too broad, too
 * likely to matter, or already gone.
 */
export const BULK_TRASH_LABELS: { id: string; label: string }[] = [
  { id: "SPAM", label: "Spam" },
  ...SCAN_LABELS,
];

/* ── Reads ────────────────────────────────────────────────── */

export type ScanStatus = "running" | "completed" | "failed";

export type CleanupScan = {
  id: string;
  /** The running BullMQ job's id — what the SSE progress endpoint subscribes to. Null once finished (jobs are pruned; the Postgres row is the permanent record). */
  jobId: string | null;
  label: string | null;
  status: ScanStatus;
  messagesScanned: number;
  candidatesFound: number;
  analyzerProvider: string | null;
  errorDetail: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export async function latestScan(connectorId: string): Promise<CleanupScan | null> {
  const row = await queryOne<{
    id: string;
    job_id: string | null;
    label: string | null;
    status: ScanStatus;
    messages_scanned: number;
    candidates_found: number;
    analyzer_provider: string | null;
    error_detail: string | null;
    started_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT id, job_id, label, status, messages_scanned, candidates_found, analyzer_provider, error_detail, started_at, finished_at
       FROM cleanup_scans WHERE connector_id = $1
      ORDER BY started_at DESC LIMIT 1`,
    [connectorId],
  );
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.status === "running" ? row.job_id : null,
    label: row.label,
    status: row.status,
    messagesScanned: row.messages_scanned,
    candidatesFound: row.candidates_found,
    analyzerProvider: row.analyzer_provider,
    errorDetail: row.error_detail,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export type CleanupCandidateStatus = "pending" | "approved" | "trashed" | "dismissed";

export type CleanupCandidate = {
  id: string;
  messageId: string;
  threadId: string | null;
  subject: string;
  from: string;
  receivedAt: Date | null;
  sizeEstimate: number;
  reason: string;
  llmReason: string | null;
  confidence: Confidence;
  status: CleanupCandidateStatus;
};

export async function listCleanupCandidates(
  connectorId: string,
  status: CleanupCandidateStatus = "pending",
): Promise<CleanupCandidate[]> {
  const rows = await query<{
    id: string;
    message_id: string;
    thread_id: string | null;
    subject: string;
    from_address: string;
    received_at: Date | null;
    size_estimate: number;
    heuristic_reason: string;
    llm_reason: string | null;
    confidence: Confidence;
    status: CleanupCandidateStatus;
  }>(
    `SELECT id, message_id, thread_id, subject, from_address, received_at, size_estimate,
            heuristic_reason, llm_reason, confidence, status
       FROM cleanup_candidates
      WHERE connector_id = $1 AND status = $2
      ORDER BY CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, received_at`,
    [connectorId, status],
  );
  return rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    threadId: r.thread_id,
    subject: r.subject,
    from: r.from_address,
    receivedAt: r.received_at,
    sizeEstimate: r.size_estimate,
    reason: r.heuristic_reason,
    llmReason: r.llm_reason,
    confidence: r.confidence,
    status: r.status,
  }));
}

export async function cleanupCounts(connectorId: string) {
  const rows = await query<{ status: CleanupCandidateStatus; count: string }>(
    `SELECT status, count(*)::text AS count FROM cleanup_candidates WHERE connector_id = $1 GROUP BY status`,
    [connectorId],
  );
  const counts: Record<CleanupCandidateStatus, number> = { pending: 0, approved: 0, trashed: 0, dismissed: 0 };
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

/* ── Scan ─────────────────────────────────────────────────── */

/** Asks the analyzer LLM to double-check one batch, returning ids it vetoes and reason text for the rest. */
async function refineWithLlm(
  providerId: string,
  model: string | undefined,
  batch: { message: ScannedMessage; heuristicReason: string }[],
): Promise<Map<string, { keep: boolean; reason: string }>> {
  const listing = batch
    .map(
      (b, i) =>
        `${i}. From: ${b.message.from}\n   Subject: ${b.message.subject}\n   Snippet: ${b.message.snippet.slice(0, 200)}\n   Heuristic flagged it because: ${b.heuristicReason}`,
    )
    .join("\n\n");

  const raw = await chatComplete(
    providerId,
    [
      {
        role: "system",
        content:
          "You help a person clean up their email inbox. You are given emails a heuristic already flagged as low-value (old, promotional-looking, from an automated sender) and already excluded anything unread, starred, or marked important. " +
          'For each one, decide if it genuinely looks safe to delete. Reply with ONLY a JSON array, no prose, no markdown fences: [{"i": 0, "delete": true, "reason": "one short sentence"}, ...] — one entry per email, in order.',
      },
      { role: "user", content: listing },
    ],
    { model },
  );

  const match = /\[[\s\S]*\]/.exec(raw);
  if (!match) throw new Error("Analyzer did not return a JSON array");
  const parsed = JSON.parse(match[0]) as { i: number; delete: boolean; reason: string }[];

  const result = new Map<string, { keep: boolean; reason: string }>();
  for (const entry of parsed) {
    const item = batch[entry.i];
    if (!item) continue;
    result.set(item.message.id, { keep: !entry.delete, reason: String(entry.reason ?? "").slice(0, 300) });
  }
  return result;
}

/**
 * Scans up to `maxMessages` of a Gmail account's older, already-read mail,
 * heuristically narrows it to cleanup candidates, optionally refines that set
 * with the configured analyzer LLM, and writes the results to Postgres.
 *
 * Safe to call repeatedly: a message the user already approved, trashed, or
 * dismissed is never overwritten by a later scan (`ON CONFLICT ... WHERE
 * status = 'pending'`), so re-scanning only ever affects undecided rows.
 */
export async function runInboxScan(
  connectorId: string,
  maxMessages: number,
  label: string | null = null,
  jobId?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const connector = await getConnector(connectorId);
  if (!connector || connector.kind !== "google_gmail") {
    throw new Error("Not a Gmail connector");
  }

  const scan = await queryOne<{ id: string }>(
    `INSERT INTO cleanup_scans (connector_id, label, job_id, status) VALUES ($1, $2, $3, 'running') RETURNING id`,
    [connectorId, label, jobId ?? null],
  );
  const scanId = scan!.id;

  try {
    const analyzer = await emailAnalyzerProvider(connector.orgId);

    let scanned = 0;
    let found = 0;
    let pendingLlmBatch: { message: ScannedMessage; heuristicReason: string; confidence: Confidence }[] = [];

    const flushLlmBatch = async () => {
      if (pendingLlmBatch.length === 0) return;
      const batch = pendingLlmBatch;
      pendingLlmBatch = [];

      let verdicts: Map<string, { keep: boolean; reason: string }> | null = null;
      if (analyzer) {
        try {
          verdicts = await refineWithLlm(analyzer.id, analyzer.emailModel ?? undefined, batch);
        } catch {
          // The heuristic result alone is still useful — never let an LLM
          // hiccup (timeout, bad JSON, endpoint down) block the whole scan.
          verdicts = null;
        }
      }

      for (const item of batch) {
        const verdict = verdicts?.get(item.message.id);
        if (verdict?.keep) continue; // the analyzer vetoed this one

        await query(
          `INSERT INTO cleanup_candidates
             (scan_id, connector_id, message_id, thread_id, subject, from_address, received_at,
              size_estimate, heuristic_reason, llm_reason, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (connector_id, message_id) DO UPDATE
             SET scan_id = excluded.scan_id, heuristic_reason = excluded.heuristic_reason,
                 llm_reason = excluded.llm_reason, confidence = excluded.confidence
             WHERE cleanup_candidates.status = 'pending'`,
          [
            scanId,
            connectorId,
            item.message.id,
            item.message.threadId,
            item.message.subject.slice(0, 500),
            item.message.from.slice(0, 500),
            item.message.date,
            item.message.sizeEstimate,
            item.heuristicReason,
            verdict?.reason ?? null,
            item.confidence,
          ],
        );
        found++;
      }
    };

    for await (const page of scanMail(connectorId, connector.orgId, scanQueryFor(label), maxMessages)) {
      for (const message of page) {
        scanned++;
        if (!isEligible(message)) continue;
        const verdict = classify(message);
        if (!verdict.candidate) continue;

        pendingLlmBatch.push({ message, heuristicReason: verdict.reason, confidence: verdict.confidence });
        if (pendingLlmBatch.length >= LLM_BATCH_SIZE) await flushLlmBatch();
      }
      await query(`UPDATE cleanup_scans SET messages_scanned = $2 WHERE id = $1`, [scanId, scanned]);
      onProgress?.(scanned, maxMessages);
    }
    await flushLlmBatch();

    await query(
      `UPDATE cleanup_scans
          SET status = 'completed', messages_scanned = $2, candidates_found = $3,
              analyzer_provider = $4, finished_at = now()
        WHERE id = $1`,
      [scanId, scanned, found, analyzer?.name ?? null],
    );
  } catch (error) {
    await query(
      `UPDATE cleanup_scans SET status = 'failed', error_detail = $2, finished_at = now() WHERE id = $1`,
      [scanId, error instanceof Error ? error.message : "Unknown error"],
    );
    throw error;
  }
}

/* ── Acting on candidates ─────────────────────────────────── */

export async function dismissCandidates(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await query(`UPDATE cleanup_candidates SET status = 'dismissed', decided_at = now() WHERE id = ANY ($1)`, [
    ids,
  ]);
}

/**
 * Moves the given candidates to Gmail Trash. Requires the connector's granted
 * scope to include `gmail.modify` — checked up front so a whole batch doesn't
 * fail message-by-message when the real fix is reconnecting the account once.
 */
export async function trashCandidates(
  connectorId: string,
  ids: string[],
): Promise<{ trashed: number; failed: { id: string; error: string }[] }> {
  if (ids.length === 0) return { trashed: 0, failed: [] };

  const connector = await getConnector(connectorId);
  if (!connector) throw new Error("Connector not found");
  if (!hasGmailModifyScope(connector)) {
    throw new Error(
      `${connector.name} was connected before cleanup actions existed and only has read access — reconnect it on /connectors to grant Gmail permission to trash messages.`,
    );
  }

  const rows = await query<{ id: string; message_id: string }>(
    `SELECT id, message_id FROM cleanup_candidates WHERE id = ANY ($1) AND connector_id = $2`,
    [ids, connectorId],
  );

  let trashed = 0;
  const failed: { id: string; error: string }[] = [];
  for (const row of rows) {
    try {
      await trashMail(row.message_id, connector.orgId, connectorId);
      await query(`UPDATE cleanup_candidates SET status = 'trashed', decided_at = now() WHERE id = $1`, [
        row.id,
      ]);
      trashed++;
    } catch (error) {
      failed.push({ id: row.id, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }
  return { trashed, failed };
}

/** One run's worth of a bulk trash — more than this needs another click. */
const BULK_TRASH_CAP = 2_000;

/**
 * Moves everything currently in one label (Spam, or a category like
 * Promotions) to Trash — no review, unlike the heuristic scan. Meant for a
 * label that's already presumptively junk in bulk. Deliberately trash, not a
 * permanent delete: a true permanent `messages.delete`/`batchDelete` needs the
 * `https://mail.google.com/` scope (full mailbox access, send included),
 * which this app doesn't request for the sake of a cleanup button.
 *
 * Runs as a background job (see `lib/queue.ts`), so `onProgress` is how the
 * UI's progress bar finds out how far along it is between polls.
 */
export async function runTrashLabel(
  connectorId: string,
  label: string,
  onProgress?: (trashed: number, total: number) => void,
): Promise<{ trashed: number; total: number }> {
  const connector = await getConnector(connectorId);
  if (!connector) throw new Error("Connector not found");
  if (!hasGmailModifyScope(connector)) {
    throw new Error(
      `${connector.name} was connected before cleanup actions existed and only has read access — reconnect it on /connectors to grant Gmail permission to trash messages.`,
    );
  }
  const searchQuery = LABEL_QUERIES[label];
  if (!searchQuery) throw new Error(`Unknown label: ${label}`);

  const total = await labelCount(label, connector.orgId, connectorId);
  let trashed = 0;
  onProgress?.(trashed, total);

  for await (const page of scanMail(connectorId, connector.orgId, searchQuery, BULK_TRASH_CAP)) {
    for (const message of page) {
      await trashMail(message.id, connector.orgId, connectorId);
      trashed++;
      onProgress?.(trashed, total);
    }
  }
  return { trashed, total };
}
