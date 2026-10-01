/**
 * The assistant's Discussion tools — reading a project's comments, and posting one as the user.
 *
 * Posting notifies real people, so it's two-step and checked in code, not just asked for in the prompt:
 * the first call only previews — the text as it will read, who gets notified — and stores exactly that
 * comment (assistant_pending_actions). `confirm: true` then posts the stored preview, never re-sent
 * text, and only once the user has written a new message since the preview (their answer to it),
 * within 30 minutes, once.
 */
import { listTeam } from "@/lib/auth";
import { commentPlainText, type Ref } from "@/lib/comment-text";
import { queryOne } from "@/lib/db";
import { addProjectComment, listProjectComments, projectRefs } from "@/lib/project-comments";

const KIND = "post_project_comment";

type ToolResult = { summary: string; data?: unknown };

/** The thread as text: comments in order, replies indented, names and #labels filled in, ids for replying. */
export async function readDiscussion(orgId: string, projectId: string, projectTitle: string): Promise<ToolResult> {
  const [comments, team, refs] = await Promise.all([listProjectComments(projectId, orgId), listTeam(orgId), projectRefs(projectId, orgId)]);
  if (comments.length === 0) return { summary: `"${projectTitle}" has no discussion yet.`, data: { comments: [] } };
  const names = new Map(team.map((p) => [p.id, p.name || p.email]));
  const labels = new Map(refs.map((r) => [`${r.kind}:${r.id}`, r.label]));
  const depth = new Map<string, number>();
  const children = new Map<string | null, typeof comments>();
  for (const c of comments) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
  const ordered: { id: string; depth: number; author: string; at: string; text: string; replyTo: string | null }[] = [];
  const walk = (parent: string | null, d: number) => {
    for (const c of children.get(parent) ?? []) {
      depth.set(c.id, d);
      ordered.push({
        id: c.id,
        depth: d,
        author: c.deleted ? "[deleted]" : c.authorName,
        at: c.createdAt.toISOString(),
        text: c.deleted ? "[deleted]" : commentPlainText(c.body, (id) => names.get(id), (kind, id) => labels.get(`${kind}:${id}`)),
        replyTo: c.parentId,
      });
      walk(c.id, d + 1);
    }
  };
  walk(null, 0);
  return {
    summary: `Read ${comments.filter((c) => !c.deleted).length} comment(s) on "${projectTitle}" (depth = reply level; pass a comment's id as parentCommentId to reply to it).`,
    data: { comments: ordered, link: `/projects/${projectId}#discussion` },
  };
}

/** "@Joy Wang" / "#Production checklist" in the model's text → tokens, or what couldn't be matched. */
function resolve(
  body: string,
  mentions: string[],
  references: string[],
  team: { id: string; name: string; email: string }[],
  refs: Ref[],
): { body: string; notify: { id: string; name: string }[] } | { error: string } {
  let out = body;
  const notify: { id: string; name: string }[] = [];
  for (const raw of mentions) {
    const wanted = raw.replace(/^@/, "").trim().toLowerCase();
    const matches = team.filter(
      (p) => p.email.toLowerCase() === wanted || p.name.toLowerCase() === wanted || p.name.toLowerCase().split(/\s+/)[0] === wanted,
    );
    if (matches.length === 0) return { error: `No one in this workspace matches "${raw}". People: ${team.map((p) => p.name || p.email).join(", ")}.` };
    if (matches.length > 1) return { error: `"${raw}" could be ${matches.map((p) => `${p.name} (${p.email})`).join(" or ")} — ask the user which one.` };
    const person = matches[0];
    const shown = `@${raw.replace(/^@/, "").trim()}`;
    if (!out.includes(shown)) out = `${out} ${shown}`;
    out = out.split(shown).join(`<@${person.id}>`);
    notify.push({ id: person.id, name: person.name || person.email });
  }
  for (const raw of references) {
    const wanted = raw.replace(/^#/, "").trim().toLowerCase();
    const exact = refs.filter((r) => r.label.toLowerCase() === wanted);
    const matches = exact.length ? exact : refs.filter((r) => r.label.toLowerCase().includes(wanted));
    if (matches.length === 0) {
      return { error: `Nothing on this project matches "${raw}". It has: ${refs.map((r) => `${r.kind} "${r.label}"`).join("; ") || "no tasks, invoices, files, photos or estimates"}.` };
    }
    if (matches.length > 1) return { error: `"${raw}" matches ${matches.map((r) => `${r.kind} "${r.label}"`).join(", ")} — use the exact title.` };
    const shown = `#${raw.replace(/^#/, "").trim()}`;
    if (!out.includes(shown)) out = `${out} ${shown}`;
    out = out.split(shown).join(`<#${matches[0].kind}:${matches[0].id}>`);
  }
  return { body: out, notify };
}

type PendingComment = {
  projectId: string;
  projectTitle: string;
  parentId: string | null;
  body: string;
  preview: string;
  notifies: string[];
};

export async function postComment(input: {
  orgId: string;
  person: { id: string; name: string } | null;
  conversationId: string | undefined;
  projectId: string;
  projectTitle: string;
  body: string;
  mentions: string[];
  references: string[];
  parentCommentId: string | null;
  confirm: boolean;
}): Promise<ToolResult> {
  const { orgId, person, conversationId, projectId } = input;
  if (!person || !conversationId) return { summary: "post_project_comment failed: only available in a chat with a signed-in person." };

  // Step 2: post the comment previewed earlier in this conversation — if the user has answered since.
  if (input.confirm) {
    const pending = await queryOne<{ id: string; payload: PendingComment }>(
      `UPDATE assistant_pending_actions a SET done_at = now()
        WHERE a.id = (
          SELECT p.id FROM assistant_pending_actions p
           WHERE p.conversation_id = $1 AND p.person_id = $2 AND p.kind = $3 AND p.done_at IS NULL
             AND p.created_at > now() - interval '30 minutes'
             AND EXISTS (SELECT 1 FROM agent_messages m
                          WHERE m.conversation_id = p.conversation_id AND m.role = 'user'
                            AND m.person_id = p.person_id AND m.created_at > p.created_at)
           ORDER BY p.created_at DESC LIMIT 1)
        AND a.done_at IS NULL
        RETURNING a.id, a.payload`,
      [conversationId, person.id, KIND],
    );
    if (!pending) {
      return {
        summary:
          "post_project_comment failed: there's no previewed comment the user has answered — preview it first " +
          "(call without confirm), show it to them, and wait for their yes.",
      };
    }
    const c = pending.payload;
    const result = await addProjectComment(orgId, c.projectId, person, c.body, c.parentId);
    if ("error" in result) return { summary: `post_project_comment failed: ${result.error}` };
    return {
      summary: `Posted the comment on "${c.projectTitle}"${c.notifies.length ? ` — notified ${c.notifies.join(", ")}` : ""}.`,
      data: { id: result.id, posted: c.preview, link: `/projects/${c.projectId}#discussion` },
    };
  }

  // Step 1: resolve, store, and preview — nothing is posted.
  if (!input.body) return { summary: "post_project_comment failed: body is required." };
  const [team, refs] = await Promise.all([listTeam(orgId), projectRefs(projectId, orgId)]);
  const resolved = resolve(input.body, input.mentions, input.references, team, refs);
  if ("error" in resolved) return { summary: `post_project_comment failed: ${resolved.error}` };
  if (input.parentCommentId) {
    const parent = await queryOne<{ id: string }>(
      `SELECT id FROM project_comments WHERE id = $1 AND project_id = $2 AND org_id = $3 AND deleted_at IS NULL`,
      [input.parentCommentId, projectId, orgId],
    );
    if (!parent) return { summary: "post_project_comment failed: the comment to reply to isn't on this project (call read_project_discussion for ids)." };
  }
  const names = new Map(team.map((p) => [p.id, p.name || p.email]));
  const labels = new Map(refs.map((r) => [`${r.kind}:${r.id}`, r.label]));
  const pending: PendingComment = {
    projectId,
    projectTitle: input.projectTitle,
    parentId: input.parentCommentId,
    body: resolved.body,
    preview: commentPlainText(resolved.body, (id) => names.get(id), (kind, id) => labels.get(`${kind}:${id}`)),
    notifies: resolved.notify.filter((p) => p.id !== person.id).map((p) => p.name),
  };
  // A new preview replaces any earlier one still waiting in this conversation.
  await queryOne(
    `UPDATE assistant_pending_actions SET done_at = now() WHERE conversation_id = $1 AND kind = $2 AND done_at IS NULL`,
    [conversationId, KIND],
  );
  await queryOne(
    `INSERT INTO assistant_pending_actions (conversation_id, person_id, kind, payload) VALUES ($1, $2, $3, $4)`,
    [conversationId, person.id, KIND, JSON.stringify(pending)],
  );
  return {
    summary:
      `Previewed a comment on "${input.projectTitle}"${input.parentCommentId ? " (a reply)" : ""} — not posted. Show the user ` +
      `the preview and ${pending.notifies.length ? `that it notifies ${pending.notifies.join(", ")}` : "that it notifies no one"}, ` +
      "and ask them to confirm. When they say yes, call post_project_comment with confirm: true.",
    data: { preview: pending.preview, notifies: pending.notifies },
  };
}
