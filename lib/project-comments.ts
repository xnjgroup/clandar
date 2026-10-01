/**
 * A project's Discussion (project_comments): threaded comments — anyone in the org can comment or
 * reply; the author can edit, the author or an owner can delete. @-mentions (lib/comment-text.ts)
 * notify the people mentioned, and a reply notifies the comment's author: a bell notification and a
 * push (browser and iPhone), linking back to the discussion. #-references point at the project's
 * tasks, invoices, files, photos and estimates (`projectRefs` lists what can be referenced).
 */
import { listTeam } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { commentPlainText, mentionedIds, referencedRefs, type Ref, type RefKind } from "@/lib/comment-text";
import { createNotification } from "@/lib/notifications";
import { pushToPerson } from "@/lib/push";

export const COMMENT_MAX_LENGTH = 10_000;

export type ProjectComment = {
  id: string;
  parentId: string | null;
  /** Empty when deleted (kept as "[deleted]" so its replies stay in place). */
  body: string;
  deleted: boolean;
  authorId: string | null;
  authorName: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Every comment on the project, oldest first — the client nests them by `parentId`. */
export async function listProjectComments(projectId: string, orgId: string): Promise<ProjectComment[]> {
  const rows = await query<{
    id: string;
    parent_id: string | null;
    body: string;
    deleted_at: Date | null;
    author_id: string | null;
    author_name: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT c.id, c.parent_id, c.body, c.deleted_at, c.author_id,
            coalesce(nullif(p.name, ''), p.email) AS author_name, c.created_at, c.updated_at
       FROM project_comments c LEFT JOIN people p ON p.id = c.author_id
      WHERE c.project_id = $1 AND c.org_id = $2
      ORDER BY c.created_at`,
    [projectId, orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    body: r.deleted_at ? "" : r.body,
    deleted: r.deleted_at !== null,
    authorId: r.author_id,
    authorName: r.author_name ?? "Former member",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** What a comment on this project can #-reference — its tasks, invoices, files, photos and estimates. */
export async function projectRefs(projectId: string, orgId: string): Promise<Ref[]> {
  const rows = await query<{ kind: RefKind; id: string; label: string; slug: string | null }>(
    `SELECT 'task' AS kind, t.id, t.title AS label, NULL AS slug FROM tasks t WHERE t.project_id = $1 AND t.org_id = $2
     UNION ALL
     SELECT 'invoice', i.id, v.name || ' · $' || to_char(i.amount, 'FM999,999,990.00') || ' · ' || i.invoice_date::text, v.slug
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.project_id = $1 AND i.org_id = $2
     UNION ALL
     SELECT 'file', f.id, f.file_name, NULL FROM project_files f JOIN projects j ON j.id = f.project_id
      WHERE f.project_id = $1 AND j.org_id = $2
     UNION ALL
     SELECT 'photo', ph.id, coalesce(nullif(ph.caption, ''), 'Photo · ' || to_char(ph.created_at, 'Mon DD')), NULL
       FROM project_photos ph JOIN projects j ON j.id = ph.project_id WHERE ph.project_id = $1 AND j.org_id = $2
     UNION ALL
     SELECT 'estimate', e.id, 'Estimate · $' || to_char(e.total, 'FM999,999,990.00') || ' · ' || e.status, NULL
       FROM estimates e WHERE e.project_id = $1 AND e.org_id = $2`,
    [projectId, orgId],
  );
  return rows.map((r) => ({ kind: r.kind, id: r.id, label: r.label, link: refLink(projectId, r.kind, r.id, r.slug) }));
}

/** Where a referenced thing opens on the website. */
function refLink(projectId: string, kind: RefKind, id: string, slug: string | null): string | null {
  switch (kind) {
    case "task":
      return `/tasks/${id}`;
    case "invoice":
      return slug ? `/invoices/${slug}?id=${id}` : null;
    case "file":
      return `/api/projects/${projectId}/files/${id}`;
    case "photo":
      return `/api/projects/${projectId}/photos/${id}`;
    case "estimate":
      return `/projects/${projectId}#estimate-${id}`;
  }
}

/** Validates a comment's text: trimmed, not empty, not too long. */
function clean(body: string): { body: string } | { error: string } {
  const text = body.replace(/\r\n/g, "\n").trim();
  if (!text) return { error: "Write something first." };
  if (text.length > COMMENT_MAX_LENGTH) return { error: `Keep a comment under ${COMMENT_MAX_LENGTH.toLocaleString()} characters.` };
  return { body: text };
}

/** Adds a comment, or a reply when `parentId` is set (it must be on the same project). */
export async function addProjectComment(
  orgId: string,
  projectId: string,
  author: { id: string; name: string },
  body: string,
  parentId: string | null = null,
): Promise<{ id: string } | { error: string }> {
  const cleaned = clean(body);
  if ("error" in cleaned) return cleaned;
  const project = await queryOne<{ title: string }>(`SELECT title FROM projects WHERE id = $1 AND org_id = $2`, [projectId, orgId]);
  if (!project) return { error: "Project not found." };
  let parentAuthor: string | null = null;
  if (parentId) {
    const parent = await queryOne<{ author_id: string | null }>(
      `SELECT author_id FROM project_comments WHERE id = $1 AND project_id = $2 AND org_id = $3`,
      [parentId, projectId, orgId],
    );
    if (!parent) return { error: "The comment you're replying to is gone." };
    parentAuthor = parent.author_id;
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO project_comments (org_id, project_id, parent_id, author_id, body) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [orgId, projectId, parentId, author.id, cleaned.body],
  );
  await notify(orgId, projectId, project.title, author, cleaned.body, [], parentAuthor);
  return { id: row!.id };
}

/** Edits a comment (its author only). People newly mentioned by the edit are notified. */
export async function updateProjectComment(
  orgId: string,
  commentId: string,
  editor: { id: string; name: string },
  body: string,
): Promise<{ projectId: string } | { error: string }> {
  const cleaned = clean(body);
  if ("error" in cleaned) return cleaned;
  const existing = await queryOne<{ body: string; author_id: string | null; project_id: string; title: string; deleted_at: Date | null }>(
    `SELECT c.body, c.author_id, c.project_id, j.title, c.deleted_at FROM project_comments c JOIN projects j ON j.id = c.project_id
      WHERE c.id = $1 AND c.org_id = $2`,
    [commentId, orgId],
  );
  if (!existing || existing.deleted_at) return { error: "Comment not found." };
  if (existing.author_id !== editor.id) return { error: "Only the comment's author can edit it." };
  await query(`UPDATE project_comments SET body = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [commentId, orgId, cleaned.body]);
  await notify(orgId, existing.project_id, existing.title, editor, cleaned.body, mentionedIds(existing.body), null);
  return { projectId: existing.project_id };
}

/**
 * Deletes a comment (its author, or an owner). One with replies is blanked to "[deleted]" so the
 * thread under it stays; one without is removed outright.
 */
export async function deleteProjectComment(
  orgId: string,
  commentId: string,
  person: { id: string; role: string },
): Promise<{ projectId: string } | { error: string }> {
  const existing = await queryOne<{ author_id: string | null; project_id: string; replies: number }>(
    `SELECT c.author_id, c.project_id, (SELECT count(*)::int FROM project_comments r WHERE r.parent_id = c.id) AS replies
       FROM project_comments c WHERE c.id = $1 AND c.org_id = $2`,
    [commentId, orgId],
  );
  if (!existing) return { error: "Comment not found." };
  if (existing.author_id !== person.id && person.role !== "owner") return { error: "Only the comment's author or an owner can delete it." };
  if (existing.replies > 0) {
    await query(`UPDATE project_comments SET body = '', deleted_at = now() WHERE id = $1 AND org_id = $2`, [commentId, orgId]);
  } else {
    await query(`DELETE FROM project_comments WHERE id = $1 AND org_id = $2`, [commentId, orgId]);
  }
  return { projectId: existing.project_id };
}

/**
 * Bell + push: everyone mentioned in `body` (in the org, not the writer, not already notified), and
 * the author of the comment being replied to.
 */
async function notify(
  orgId: string,
  projectId: string,
  projectTitle: string,
  writer: { id: string; name: string },
  body: string,
  alreadyNotified: string[],
  repliedTo: string | null,
): Promise<void> {
  const mentioned = mentionedIds(body).filter((id) => id !== writer.id && !alreadyNotified.includes(id));
  const replyTarget = repliedTo && repliedTo !== writer.id && !mentioned.includes(repliedTo) ? repliedTo : null;
  if (mentioned.length === 0 && !replyTarget) return;

  const [team, refs] = await Promise.all([listTeam(orgId), referencedRefs(body).length ? projectRefs(projectId, orgId) : []]);
  const names = new Map(team.map((p) => [p.id, p.name || p.email]));
  const labels = new Map(refs.map((r) => [`${r.kind}:${r.id}`, r.label]));
  const text = commentPlainText(body, (id) => names.get(id), (kind, id) => labels.get(`${kind}:${id}`));
  const preview = text.length > 300 ? `${text.slice(0, 299)}…` : text;
  const link = `/projects/${projectId}#discussion`;

  const send = async (personId: string, title: string) => {
    if (!names.has(personId)) return;
    await createNotification({ orgId, personId, title, body: preview, link });
    await pushToPerson(personId, { title, body: preview, link }).catch(() => {});
  };
  await Promise.all([
    ...mentioned.map((id) => send(id, `${writer.name} mentioned you in ${projectTitle}`)),
    ...(replyTarget ? [send(replyTarget, `${writer.name} replied to you in ${projectTitle}`)] : []),
  ]);
}
