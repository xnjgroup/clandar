import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, CardTitle, PageBody, TableCard } from "@/components/ui";
import { firstParam, hrefWith } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { GmailError, fileSize, readMail } from "@/lib/gmail";

/**
 * The message body is untrusted HTML from a stranger, so it is rendered inside a
 * sandboxed iframe with its own strict CSP: no scripts, no remote images or
 * fonts, no network of any kind. Inline images (`data:`) still show.
 */
function HtmlBody({ html }: { html: string }) {
  const document = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:">
<style>
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; padding: 16px; font: 13px/1.6 -apple-system, "Segoe UI", sans-serif; color: #24271f; word-break: break-word; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #41631a; }
</style></head><body>${html}</body></html>`;

  return (
    <iframe
      sandbox=""
      srcDoc={document}
      title="Message body"
      referrerPolicy="no-referrer"
      className="h-[60vh] w-full border-0 bg-white"
    />
  );
}

export default async function EmailDetailPage({ params, searchParams }: PageProps<"/email/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const view = firstParam(query.view);
  const search = firstParam(query.q);
  const account = firstParam(query.account);
  const asText = firstParam(query.body) === "text";
  const { org } = await requireSession();

  let message;
  try {
    message = await readMail(id, org.id, account || undefined);
  } catch (error) {
    if (error instanceof GmailError && !error.reconnect) notFound();
    const detail = error instanceof Error ? error.message : "Unexpected error";
    return (
      <PageBody>
        <Card className="flex flex-col items-center gap-[10px] py-9 text-center">
          <CardTitle>Could not open this message</CardTitle>
          <span className="max-w-[460px] text-[12.5px] leading-[1.55] text-muted">{detail}</span>
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

  const backHref = hrefWith(
    "/email",
    {},
    { view: view || null, q: search || null, account: account || null },
  );
  const fields = [
    { label: "From", value: `${message.from} · ${message.fromEmail}` },
    { label: "To", value: message.to || "—" },
    ...(message.cc ? [{ label: "Cc", value: message.cc }] : []),
    {
      label: "Received",
      value: message.date
        ? message.date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "—",
    },
  ];

  const showText = asText || message.html === null;

  return (
    <PageBody>
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={backHref}
          aria-label="Back to email"
          className="flex size-[34px] shrink-0 items-center justify-center rounded-[12px] border border-line bg-surface"
        >
          <Icon name="chevL" size={18} />
        </Link>
        <Link href={backHref} className="text-[13px] text-muted">
          Email
        </Link>
        <span className="text-[13px] text-[#c2c7bd]">/</span>
        <span className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.015em]">
          {message.subject}
        </span>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-[14px]">
        <TableCard>
          <div className="flex flex-wrap items-center gap-[10px] border-b border-line-soft px-4 py-3">
            {message.unread ? (
              <span className="rounded-full bg-ok-bg px-[9px] py-1 text-[11px] font-medium text-ok-fg">
                unread
              </span>
            ) : null}
            {message.labels.slice(0, 4).map((label) => (
              <span
                key={label}
                className="rounded-full bg-idle-bg px-2 py-[3px] font-mono text-[10px] text-body-soft"
              >
                {label.toLowerCase().replace(/^category_/, "")}
              </span>
            ))}
            <div className="ml-auto flex shrink-0 items-center gap-3">
              {message.html && message.text ? (
                <Link
                  href={hrefWith(`/email/${id}`, query, { body: showText ? null : "text" })}
                  className="text-[11.5px] font-medium underline"
                >
                  {showText ? "Show formatted" : "Show plain text"}
                </Link>
              ) : null}
              <a
                href={`https://mail.google.com/mail/u/0/#all/${message.id}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[11.5px] font-medium underline"
              >
                Open in Gmail
              </a>
            </div>
          </div>

          {showText ? (
            <pre className="m-0 overflow-x-auto px-4 py-4 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-body">
              {message.text ?? message.snippet}
            </pre>
          ) : (
            <HtmlBody html={message.html!} />
          )}
        </TableCard>

        <div className="flex min-w-0 flex-col gap-3">
          <section className="flex min-w-0 flex-col gap-[11px] rounded-[20px] border border-line bg-surface p-[17px]">
            <h2 className="m-0 text-[14.5px] font-bold tracking-[-0.02em]">Message</h2>
            <dl className="m-0 flex flex-col">
              {fields.map((field) => (
                <div
                  key={field.label}
                  className="flex min-w-0 flex-col gap-[2px] border-b border-line-faint py-[9px]"
                >
                  <dt className="text-[11px] text-muted">{field.label}</dt>
                  <dd className="m-0 text-[12.5px] font-medium break-words">{field.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="flex min-w-0 flex-col gap-[11px] rounded-[20px] border border-line bg-surface p-[17px]">
            <div className="flex flex-wrap items-center gap-[9px]">
              <h2 className="m-0 text-[14.5px] font-bold tracking-[-0.02em]">Attachments</h2>
              <span className="font-mono text-[10.5px] text-faint">
                {message.attachments.length}
              </span>
            </div>

            {message.attachments.length === 0 ? (
              <span className="text-[12px] text-muted">Nothing attached to this message.</span>
            ) : (
              message.attachments.map((attachment) => (
                <a
                  key={attachment.attachmentId}
                  href={hrefWith(
                    `/api/email/${id}/attachments/${attachment.attachmentId}`,
                    {},
                    { account: account || null },
                  )}
                  className="flex min-w-0 items-center gap-[10px] rounded-[14px] border border-line-soft px-[12px] py-[10px] hover:bg-[#fafbf9]"
                >
                  <Icon name="doc" size={16} className="shrink-0 text-body-soft" />
                  <span className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                    <span className="truncate text-[12.5px] font-medium">
                      {attachment.filename}
                    </span>
                    <span className="truncate text-[11px] text-muted">
                      {attachment.mimeType} · {fileSize(attachment.size)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] font-medium underline">Open</span>
                </a>
              ))
            )}
          </section>
        </div>
      </div>
    </PageBody>
  );
}
