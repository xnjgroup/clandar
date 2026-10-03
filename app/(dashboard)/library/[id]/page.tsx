import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBody } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { getLibraryItem } from "@/lib/library";
import { removeLibraryItem } from "../actions";

/** A saved article: where it's from, its summary and key points, and the saved text — with the original link. */
export default async function LibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await requireSession();
  const item = /^[0-9a-f-]{36}$/i.test(id) ? await getLibraryItem(id, org.id) : null;
  if (!item) notFound();
  const [summary, ...points] = (item.summary ?? "").split("\n");
  const bullets = points.map((p) => p.replace(/^•\s*/, "")).filter(Boolean);
  const meta = [item.siteName, item.author, item.publishedAt ? item.publishedAt.toLocaleDateString("en-US", { dateStyle: "medium" }) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageBody>
      <div className="flex flex-col gap-[16px] rounded-[20px] border border-line bg-surface p-[22px]">
        <div className="flex flex-wrap items-start gap-[10px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <Link href="/library" className="text-[12px] text-muted hover:underline">
              ← Library
            </Link>
            <h2 className="m-0 text-[20px] leading-[1.3] font-bold tracking-[-0.02em]">{item.title}</h2>
            {meta ? <span className="text-[12.5px] text-muted">{meta}</span> : null}
          </div>
          <div className="flex shrink-0 items-center gap-[12px] text-[12.5px]">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-ink px-[14px] py-[8px] font-semibold text-bg">
                Open original
              </a>
            ) : null}
            <form action={removeLibraryItem}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="back" value="1" />
              <button type="submit" className="cursor-pointer text-bad-fg hover:underline">
                Delete
              </button>
            </form>
          </div>
        </div>

        {summary ? (
          <div className="flex flex-col gap-[8px] rounded-[14px] bg-bg p-[16px]">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">Summary</span>
            <p className="m-0 text-[14px] leading-[1.6]">{summary}</p>
            {bullets.length > 0 ? (
              <ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px] text-[13.5px] leading-[1.55]">
                {bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : null}
            {item.tags.length > 0 ? (
              <div className="flex flex-wrap gap-[6px] pt-[4px]">
                {item.tags.map((t) => (
                  <Link key={t} href={`/library?q=${encodeURIComponent(t)}`} className="rounded-full bg-surface px-[8px] py-[2px] text-[11px] text-body-soft">
                    #{t}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {item.contentHtml ? (
          <article
            className="max-w-[760px] text-[15px] leading-[1.8] text-body [&_a]:underline [&_blockquote]:border-l-[3px] [&_blockquote]:border-line [&_blockquote]:pl-[14px] [&_blockquote]:text-body-soft [&_h1]:text-[19px] [&_h1]:font-bold [&_h2]:mt-[18px] [&_h2]:text-[17px] [&_h2]:font-bold [&_h3]:font-semibold [&_img]:my-[10px] [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-[10px] [&_li]:ml-[20px] [&_ol]:list-decimal [&_p]:my-[10px] [&_ul]:list-disc"
            // Cleaned when saved (lib/web-article.ts: sanitize-html, pictures only from our own storage).
            dangerouslySetInnerHTML={{ __html: item.contentHtml }}
          />
        ) : (
          <article className="max-w-[760px] text-[14.5px] leading-[1.75] whitespace-pre-wrap text-body">{item.content}</article>
        )}
        <p className="m-0 text-[11.5px] text-faint">A saved copy for your own reading and search — the original is at the link above.</p>
      </div>
    </PageBody>
  );
}
