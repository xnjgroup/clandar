"use client";

import { useActionState, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/icons";
import { MENTION, REF, commentSegments, videoLink, type Ref, type RefKind } from "@/lib/comment-text";
import { addComment, editComment, removeComment, type FormState } from "./actions";

type Member = { id: string; name: string; email: string };
export type CommentView = {
  id: string;
  parentId: string | null;
  body: string;
  deleted: boolean;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  edited: boolean;
};

const displayName = (m: Member) => m.name || m.email;
const REF_ICON: Record<RefKind, IconName> = { task: "clipboard", invoice: "doc", file: "doc", photo: "camera", estimate: "wallet" };
const REF_NOUN: Record<RefKind, string> = { task: "Task", invoice: "Invoice", file: "File", photo: "Photo", estimate: "Estimate" };
/** How deep replies indent before they stop stepping right (narrow screens). */
const MAX_INDENT = 4;

type Context = {
  projectId: string;
  members: Member[];
  refs: Ref[];
  viewerId: string;
  viewerIsOwner: boolean;
  children: Map<string | null, CommentView[]>;
};

/**
 * The project's Discussion: comments with threaded replies (like a forum thread). Type @ to mention
 * someone (they're notified) and # to point at one of the project's tasks, invoices, files, photos or
 * estimates; links are clickable and video links get a preview.
 */
export function DiscussionSection({
  projectId,
  comments,
  members,
  refs,
  viewerId,
  viewerIsOwner,
}: {
  projectId: string;
  comments: CommentView[];
  members: Member[];
  refs: Ref[];
  viewerId: string;
  viewerIsOwner: boolean;
}) {
  const children = new Map<string | null, CommentView[]>();
  for (const c of comments) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
  // Newest threads first; replies stay in the order they were written.
  const roots = [...(children.get(null) ?? [])].reverse();
  const ctx: Context = { projectId, members, refs, viewerId, viewerIsOwner, children };

  return (
    <div className="flex flex-col">
      <div className="border-t border-line-soft px-[18px] py-[14px]">
        <Composer ctx={ctx} />
      </div>
      {roots.length === 0 ? (
        <div className="border-t border-line-soft px-[18px] py-9 text-center text-[12.5px] text-muted">
          No comments yet. Share a link or video, ask a question — type @ to loop someone in, # to point at a task,
          invoice or file.
        </div>
      ) : (
        roots.map((c) => (
          <div key={c.id} className="border-t border-line-soft px-[18px] py-[12px]">
            <Thread comment={c} depth={0} ctx={ctx} />
          </div>
        ))
      )}
    </div>
  );
}

function countReplies(id: string, children: Context["children"]): number {
  return (children.get(id) ?? []).reduce((n, c) => n + 1 + countReplies(c.id, children), 0);
}

function Thread({ comment, depth, ctx }: { comment: CommentView; depth: number; ctx: Context }) {
  const [mode, setMode] = useState<"view" | "reply" | "edit">("view");
  const [collapsed, setCollapsed] = useState(false);
  const replies = ctx.children.get(comment.id) ?? [];
  const mine = comment.authorId === ctx.viewerId;
  const nameOf = (id: string) => {
    const m = ctx.members.find((p) => p.id === id);
    return m ? displayName(m) : "someone";
  };

  return (
    <div id={`comment-${comment.id}`} className="flex flex-col gap-[6px]">
      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-[11.5px] text-muted">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand thread" : "Collapse thread"}
          className="cursor-pointer font-mono text-[11px] text-faint hover:text-ink"
        >
          [{collapsed ? "+" : "–"}]
        </button>
        <span className={`font-semibold ${comment.deleted ? "text-faint" : "text-ink"}`}>
          {comment.deleted ? "[deleted]" : comment.authorName}
        </span>
        <span>
          <LocalDateTime iso={comment.createdAt} />
          {comment.edited && !comment.deleted ? " · edited" : ""}
        </span>
        {collapsed && replies.length > 0 ? (
          <span className="text-faint">
            · {countReplies(comment.id, ctx.children)} repl{countReplies(comment.id, ctx.children) === 1 ? "y" : "ies"} hidden
          </span>
        ) : null}
      </div>

      {collapsed ? null : (
        <>
          {mode === "edit" ? (
            <Composer ctx={ctx} comment={comment} onDone={() => setMode("view")} />
          ) : comment.deleted ? (
            <p className="m-0 text-[12.5px] text-faint italic">This comment was deleted.</p>
          ) : (
            <CommentBody body={comment.body} nameOf={nameOf} refs={ctx.refs} />
          )}

          {mode !== "edit" && !comment.deleted ? (
            <div className="flex items-center gap-[14px] text-[11.5px] font-medium text-body-soft">
              <button type="button" onClick={() => setMode(mode === "reply" ? "view" : "reply")} className="cursor-pointer hover:text-ink">
                Reply
              </button>
              {mine ? (
                <button type="button" onClick={() => setMode("edit")} className="cursor-pointer hover:text-ink">
                  Edit
                </button>
              ) : null}
              {mine || ctx.viewerIsOwner ? (
                <form action={removeComment}>
                  <input type="hidden" name="id" value={comment.id} />
                  <button type="submit" className="cursor-pointer hover:text-bad-fg">
                    Delete
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

          {mode === "reply" ? <Composer ctx={ctx} parentId={comment.id} onDone={() => setMode("view")} /> : null}

          {replies.length > 0 ? (
            <div className={`mt-[4px] flex flex-col gap-[12px] border-l-2 border-line ${depth < MAX_INDENT ? "pl-[14px]" : "pl-[6px]"}`}>
              {replies.map((r) => (
                <Thread key={r.id} comment={r} depth={depth + 1} ctx={ctx} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A comment's text: mentions and references as chips, links clickable (new tab), video previews below. */
function CommentBody({ body, nameOf, refs }: { body: string; nameOf: (id: string) => string; refs: Ref[] }) {
  const segments = commentSegments(body);
  const videos = segments
    .flatMap((s) => (s.kind === "link" ? [{ url: s.url, video: videoLink(s.url) }] : []))
    .filter((v) => v.video);
  return (
    <>
      <p className="m-0 text-[13px] leading-[1.6] break-words whitespace-pre-wrap text-body">
        {segments.map((s, i) => {
          if (s.kind === "text") return s.text;
          if (s.kind === "mention") {
            return (
              <span key={i} className="rounded-[5px] bg-ok-bg px-[4px] py-[1px] font-medium text-ok-fg">
                @{nameOf(s.personId)}
              </span>
            );
          }
          if (s.kind === "ref") {
            const ref = refs.find((r) => r.kind === s.refKind && r.id === s.id);
            const chip = (
              <span className="inline-flex items-center gap-[4px] rounded-[6px] border border-line bg-bg px-[6px] py-[1px] align-baseline text-[12px] font-medium text-ink">
                <Icon name={REF_ICON[s.refKind]} size={11} className="shrink-0 text-body-soft" />
                {ref ? ref.label : `${REF_NOUN[s.refKind]} (removed)`}
              </span>
            );
            return ref?.link ? (
              <a key={i} href={ref.link} target={ref.link.startsWith("/api/") ? "_blank" : undefined} rel="noopener" className="no-underline">
                {chip}
              </a>
            ) : (
              <span key={i}>{chip}</span>
            );
          }
          return (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-ink underline">
              {s.url.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
          );
        })}
      </p>
      {videos.length > 0 ? (
        <div className="flex flex-wrap gap-[10px]">
          {videos.map(({ url, video }) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="relative flex h-[118px] w-[210px] items-center justify-center overflow-hidden rounded-[14px] border border-line bg-idle-bg"
            >
              {video!.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- a remote thumbnail; next/image would need the host configured
                <img src={video!.thumbnail} alt="" className="absolute inset-0 size-full object-cover" referrerPolicy="no-referrer" />
              ) : null}
              <span className="relative flex size-[40px] items-center justify-center rounded-full bg-ink/80 text-bg">
                <Icon name="play" size={16} />
              </span>
              <span className="absolute bottom-[7px] left-[9px] rounded-full bg-ink/75 px-[8px] py-[2px] text-[10.5px] font-medium text-bg">
                {video!.provider}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Picked @people and #things, by the text shown in the box ("@Joy Wang", "#Book hotel"). */
type Picked = Map<string, string>;

/** Text → stored form: each picked "@Name" / "#Label" becomes its token. */
function encode(text: string, picked: Picked): string {
  let out = text;
  for (const [shown, token] of [...picked].sort((a, b) => b[0].length - a[0].length)) out = out.split(shown).join(token);
  return out;
}

/** Stored form → editable text, and what it picked. */
function decode(body: string, members: Member[], refs: Ref[]): { text: string; picked: Picked } {
  const picked: Picked = new Map();
  const text = body
    .replace(MENTION, (token, id: string) => {
      const m = members.find((p) => p.id === id.toLowerCase());
      if (!m) return token;
      picked.set(`@${displayName(m)}`, token);
      return `@${displayName(m)}`;
    })
    .replace(REF, (token, kind: string, id: string) => {
      const r = refs.find((x) => x.kind === kind.toLowerCase() && x.id === id.toLowerCase());
      if (!r) return token;
      picked.set(`#${r.label}`, token);
      return `#${r.label}`;
    });
  return { text, picked };
}

type Suggestion = { key: string; shown: string; token: string; title: string; sub: string; icon: IconName };

function Composer({
  ctx,
  parentId,
  comment,
  onDone,
}: {
  ctx: Context;
  parentId?: string;
  comment?: CommentView;
  onDone?: () => void;
}) {
  const initial = comment ? decode(comment.body, ctx.members, ctx.refs) : { text: "", picked: new Map() as Picked };
  const [text, setText] = useState(initial.text);
  const [picked] = useState(initial.picked);
  const [trigger, setTrigger] = useState<{ char: "@" | "#"; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    form.set("body", encode(text, picked));
    const result = await (comment ? editComment : addComment)(prev, form);
    if (result.ok) {
      setText("");
      picked.clear();
      onDone?.();
    }
    return result;
  }, {});

  const q = trigger?.query.toLowerCase() ?? "";
  const suggestions: Suggestion[] =
    trigger === null
      ? []
      : trigger.char === "@"
        ? ctx.members
            .filter((m) => displayName(m).toLowerCase().includes(q))
            .slice(0, 6)
            .map((m) => ({ key: m.id, shown: `@${displayName(m)}`, token: `<@${m.id}>`, title: displayName(m), sub: m.name ? m.email : "", icon: "user" }))
        : ctx.refs
            .filter((r) => r.label.toLowerCase().includes(q) || REF_NOUN[r.kind].toLowerCase().startsWith(q))
            .slice(0, 8)
            .map((r) => ({ key: `${r.kind}:${r.id}`, shown: `#${r.label}`, token: `<#${r.kind}:${r.id}>`, title: r.label, sub: REF_NOUN[r.kind], icon: REF_ICON[r.kind] }));

  /** Tracks an "@…" or "#…" being typed just before the caret. */
  function onChange(value: string) {
    setText(value);
    const caret = textarea.current?.selectionStart ?? value.length;
    const typed = value.slice(0, caret).match(/(?:^|\s)([@#])([^\s@#]*)$/u);
    setTrigger(typed ? { char: typed[1] as "@" | "#", query: typed[2] } : null);
    setHighlight(0);
  }

  function pick(s: Suggestion) {
    const el = textarea.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/[@#][^\s@#]*$/u, `${s.shown} `);
    picked.set(s.shown, s.token);
    setText(before + text.slice(caret));
    setTrigger(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setTrigger(null);
    }
  }

  return (
    <form action={action} className="flex flex-col gap-[8px]">
      <input type="hidden" name="projectId" value={ctx.projectId} />
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
      {comment ? <input type="hidden" name="id" value={comment.id} /> : null}
      <div className="relative">
        <textarea
          ref={textarea}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setTrigger(null), 150)}
          autoFocus={Boolean(parentId || comment)}
          rows={parentId ? 2 : 3}
          maxLength={10_000}
          placeholder={parentId ? "Write a reply…" : "Start a discussion — paste a link or video, @ someone, # a task, invoice or file"}
          className="w-full min-w-0 resize-y rounded-[14px] border border-line bg-surface px-[12px] py-[10px] text-[13px] leading-[1.55] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]"
        />
        {suggestions.length > 0 ? (
          <div className="absolute top-full left-0 z-20 mt-[4px] flex w-[300px] max-w-full flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_14px_40px_rgba(16,18,17,0.12)]">
            {suggestions.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className={`flex cursor-pointer items-center gap-[9px] px-[12px] py-[8px] text-left ${i === highlight ? "bg-idle-bg" : ""}`}
              >
                <Icon name={s.icon} size={13} className="shrink-0 text-body-soft" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px] font-medium">{s.title}</span>
                  {s.sub ? <span className="truncate text-[11px] text-muted">{s.sub}</span> : null}
                </span>
              </button>
            ))}
          </div>
        ) : trigger?.char === "#" && ctx.refs.length === 0 ? (
          <div className="absolute top-full left-0 z-20 mt-[4px] rounded-[12px] border border-line bg-surface px-[12px] py-[8px] text-[12px] text-muted">
            This project has no tasks, invoices, files, photos or estimates yet.
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-[10px]">
        {state.error ? <span className="text-[12px] text-bad-fg">{state.error}</span> : null}
        <span className="ml-auto flex items-center gap-[8px]">
          {onDone ? (
            <button type="button" onClick={onDone} className="cursor-pointer px-[10px] text-[12px] font-medium underline">
              Cancel
            </button>
          ) : null}
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="h-[34px] cursor-pointer rounded-full bg-ink px-[16px] text-[12px] font-semibold text-bg disabled:opacity-40"
          >
            {pending ? "Posting…" : comment ? "Save" : parentId ? "Reply" : "Post"}
          </button>
        </span>
      </div>
    </form>
  );
}

const noSubscribe = () => () => {};

/**
 * A timestamp in the reader's own time zone. Rendered only in the browser (the server's zone differs,
 * which made the server and browser text disagree — a hydration error).
 */
function LocalDateTime({ iso }: { iso: string }) {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  return (
    <time dateTime={iso}>
      {inBrowser ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null}
    </time>
  );
}
