"use client";

import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The assistant's replies, rendered as Markdown (react-markdown + GitHub-style
 * tables/lists via remark-gfm), styled to sit inside a chat bubble.
 *
 * Replies can quote content from strangers (emails), so: raw HTML is never
 * rendered (react-markdown's default), only in-app links (`/projects/…`) are
 * clickable — anything else shows as plain text with its address — and images
 * are shown as their alt text rather than loaded.
 */
export function ChatMarkdown({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const components: Components = {
    a: ({ href, children }) =>
      href && href.startsWith("/") && !href.startsWith("//") ? (
        <Link href={href} onClick={onNavigate} className="font-medium text-ok-fg underline underline-offset-2">
          {children}
        </Link>
      ) : (
        <span>
          {children}
          {href && String(children) !== href ? <span className="text-muted"> ({href})</span> : null}
        </span>
      ),
    img: ({ alt }) => (alt ? <span className="text-muted">[{alt}]</span> : null),
    p: ({ children }) => <p className="m-0 [&:not(:first-child)]:mt-[8px]">{children}</p>,
    h1: ({ children }) => <h3 className="m-0 mt-[10px] text-[14px] font-bold first:mt-0">{children}</h3>,
    h2: ({ children }) => <h3 className="m-0 mt-[10px] text-[13.5px] font-bold first:mt-0">{children}</h3>,
    h3: ({ children }) => <h4 className="m-0 mt-[8px] text-[13px] font-semibold first:mt-0">{children}</h4>,
    h4: ({ children }) => <h4 className="m-0 mt-[8px] text-[12.5px] font-semibold first:mt-0">{children}</h4>,
    ul: ({ children }) => <ul className="m-0 mt-[6px] flex list-disc flex-col gap-[3px] pl-[18px] first:mt-0">{children}</ul>,
    ol: ({ children }) => <ol className="m-0 mt-[6px] flex list-decimal flex-col gap-[3px] pl-[20px] first:mt-0">{children}</ol>,
    li: ({ children }) => <li className="pl-[2px] marker:text-muted">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
    blockquote: ({ children }) => (
      <blockquote className="m-0 mt-[8px] border-l-[3px] border-line pl-[10px] text-body-soft first:mt-0">{children}</blockquote>
    ),
    hr: () => <hr className="my-[10px] border-0 border-t border-line" />,
    code: ({ className, children }) =>
      className ? (
        <code className={`${className} font-mono text-[11.5px]`}>{children}</code>
      ) : (
        <code className="rounded-[5px] bg-line-soft px-[4px] py-[1px] font-mono text-[11.5px]">{children}</code>
      ),
    pre: ({ children }) => (
      <pre className="m-0 mt-[8px] overflow-x-auto rounded-[10px] bg-ink px-[10px] py-[8px] text-[11.5px] leading-[1.5] text-bg first:mt-0 [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="mt-[8px] max-w-full overflow-x-auto rounded-[10px] border border-line first:mt-0">
        <table className="w-full border-collapse text-[11.5px]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-line bg-line-faint px-[8px] py-[5px] text-left font-semibold whitespace-nowrap">{children}</th>
    ),
    td: ({ children }) => <td className="border-b border-line-faint px-[8px] py-[5px] align-top">{children}</td>,
  };

  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
