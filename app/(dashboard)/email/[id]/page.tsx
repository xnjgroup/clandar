import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, CardTitle, PageBody, TableCard } from "@/components/ui";
import { firstParam, hrefWith } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { EmailHtmlBody as HtmlBody } from "@/components/email-html-body";
import { TimeZoneField } from "@/components/time-zone-field";
import { GmailError, fileSize, readMail } from "@/lib/gmail";
import { getLeadForMessage } from "@/lib/lead-finder";
import { createProjectFromLead, dismissLead, followUpLead } from "../lead-actions";

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
  // Flagged by the lead finder? Then this email gets its lead strip and actions.
  const lead = await getLeadForMessage(message.id, org.id);
  const attachmentHref = (partId: string) =>
    hrefWith(`/api/email/${id}/attachments/${encodeURIComponent(partId)}`, {}, { account: account || null });
  const imageAttachments = message.attachments.filter((a) => a.mimeType.startsWith("image/"));

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

      {lead ? (
        <section className="flex min-w-0 flex-wrap items-center gap-x-[12px] gap-y-[8px] rounded-[16px] border border-line bg-surface px-[14px] py-[10px]">
          <span className="rounded-full bg-lime px-[9px] py-[2px] text-[11px] font-semibold text-ink">
            Lead · {lead.projectTypeName || "Other"}
          </span>
          <span className="min-w-0 flex-1 text-[12.5px] text-body">{lead.summary || lead.title}</span>
          {lead.status === "converted" && lead.projectId ? (
            <Link href={`/projects/${lead.projectId}`} className="text-[12px] font-semibold text-ok-fg underline">
              Project created — open it →
            </Link>
          ) : lead.status === "dismissed" ? (
            <span className="text-[11.5px] text-muted">Marked not a lead</span>
          ) : (
            <div className="flex items-center gap-[8px]">
              <form action={createProjectFromLead}>
                <input type="hidden" name="id" value={lead.id} />
                <button type="submit" className="cursor-pointer rounded-full bg-ink px-3 py-[6px] text-[11.5px] font-semibold text-bg">
                  Create project
                </button>
              </form>
              <form action={followUpLead}>
                <input type="hidden" name="id" value={lead.id} />
                <TimeZoneField />
                <button type="submit" className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium">
                  Follow up
                </button>
              </form>
              <form action={dismissLead}>
                <input type="hidden" name="id" value={lead.id} />
                <button type="submit" className="cursor-pointer text-[11.5px] font-medium text-muted underline">
                  Not a lead
                </button>
              </form>
            </div>
          )}
        </section>
      ) : null}

      {/* Message details and attachments sit above the body, compactly, so the email itself gets the full width. */}
      <section className="flex min-w-0 flex-col gap-[8px] rounded-[16px] border border-line bg-surface px-[14px] py-[9px]">
        <dl className="m-0 flex min-w-0 items-baseline gap-x-[18px] overflow-hidden text-[12.5px] whitespace-nowrap">
          {fields.map((field) => (
            <div
              key={field.label}
              // From/To can be long; they shrink first. Received stays whole.
              className={`flex min-w-0 items-baseline gap-[5px] ${field.label === "Received" ? "shrink-0" : "shrink"}`}
              title={`${field.label}: ${field.value}`}
            >
              <dt className="shrink-0 text-[11px] text-muted">{field.label}</dt>
              <dd className="m-0 min-w-0 truncate font-medium">{field.value}</dd>
            </div>
          ))}
        </dl>
        {message.attachments.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-[6px] border-t border-line-faint pt-[8px]">
            <span className="text-[11px] text-muted">
              {message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}
            </span>
            {message.attachments.map((attachment) => (
              <a
                key={attachment.partId}
                href={attachmentHref(attachment.partId)}
                target="_blank"
                rel="noreferrer"
                title={`${attachment.mimeType} · ${fileSize(attachment.size)}`}
                className="flex max-w-[260px] min-w-0 items-center gap-[6px] rounded-full border border-line-soft px-[10px] py-[5px] hover:bg-[#fafbf9]"
              >
                <Icon name={attachment.mimeType.startsWith("image/") ? "camera" : "doc"} size={13} className="shrink-0 text-body-soft" />
                <span className="truncate text-[12px] font-medium">{attachment.filename}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-faint">{fileSize(attachment.size)}</span>
              </a>
            ))}
            {/* Image attachments preview right here — often they ARE the message (a photo, a scanned receipt). */}
            {imageAttachments.length > 0 ? (
              <div className="flex w-full flex-wrap gap-[8px] pt-[4px]">
                {imageAttachments.map((attachment) => (
                  <a
                    key={attachment.partId}
                    href={attachmentHref(attachment.partId)}
                    target="_blank"
                    rel="noreferrer"
                    title={attachment.filename}
                    className="overflow-hidden rounded-[12px] border border-line-soft bg-[#fafbf9]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated API route, not a static asset */}
                    <img
                      src={attachmentHref(attachment.partId)}
                      alt={attachment.filename}
                      loading="lazy"
                      className="block max-h-[220px] w-auto max-w-[min(100%,360px)] object-contain"
                    />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

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
    </PageBody>
  );
}
