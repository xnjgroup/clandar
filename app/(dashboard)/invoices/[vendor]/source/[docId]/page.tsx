import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmailHtmlBody } from "@/components/email-html-body";
import { Icon } from "@/components/icons";
import { PageBody, TableCard } from "@/components/ui";
import { firstParam } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { parseEml } from "@/lib/eml";
import { getInvoiceDocument } from "@/lib/email-invoice";
import { readUpload } from "@/lib/storage";

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * An invoice's original email (.eml), shown in the app like a message on the
 * Email page — header, body in the same sandboxed frame, attachments — instead
 * of a file download. Other document types just open as themselves.
 */
export default async function InvoiceSourceEmailPage({
  params,
  searchParams,
}: PageProps<"/invoices/[vendor]/source/[docId]">) {
  const { vendor, docId } = await params;
  const invoiceId = firstParam((await searchParams).invoice);
  const { org } = await requireSession();
  if (!invoiceId) notFound();
  const doc = await getInvoiceDocument(docId, invoiceId, org.id);
  if (!doc) notFound();
  const fileHref = `/api/invoices/${invoiceId}/documents/${doc.id}`;
  if (doc.contentType !== "message/rfc822") redirect(fileHref);

  const email = await parseEml(await readUpload(doc.filePath));
  const invoiceHref = `/invoices/${vendor}?id=${invoiceId}`;
  const files = email.attachments.filter((a) => !a.inline);
  const fields = [
    { label: "From", value: email.from || "—" },
    { label: "To", value: email.to || "—" },
    ...(email.cc ? [{ label: "Cc", value: email.cc }] : []),
    {
      label: "Date",
      value: email.date
        ? email.date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
        : "—",
    },
  ];

  return (
    <PageBody>
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={invoiceHref}
          aria-label="Back to the invoice"
          title="Back to the invoice"
          className="flex size-[34px] shrink-0 items-center justify-center rounded-[12px] border border-line bg-surface"
        >
          <Icon name="chevL" size={18} />
        </Link>
        <Link href={invoiceHref} className="text-[13px] text-muted">
          Invoice
        </Link>
        <span className="text-[13px] text-[#c2c7bd]">/</span>
        <span className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.015em]">{email.subject}</span>
        <a href={fileHref} className="ml-auto shrink-0 text-[11.5px] font-medium underline">
          Download .eml
        </a>
      </div>

      <section className="flex min-w-0 flex-col gap-[8px] rounded-[16px] border border-line bg-surface px-[14px] py-[9px]">
        <dl className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-[18px] gap-y-[4px] text-[12.5px]">
          {fields.map((f) => (
            <div key={f.label} className="flex min-w-0 max-w-full items-baseline gap-[5px]" title={`${f.label}: ${f.value}`}>
              <dt className="shrink-0 text-[11px] text-muted">{f.label}</dt>
              <dd className="m-0 min-w-0 truncate font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
        {files.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-[6px] border-t border-line-faint pt-[8px]">
            <span className="text-[11px] text-muted">
              {files.length} attachment{files.length === 1 ? "" : "s"}
            </span>
            {files.map((a) => (
              <a
                key={a.index}
                href={`/api/invoices/${invoiceId}/documents/${doc.id}/parts/${a.index}`}
                target="_blank"
                rel="noreferrer"
                title={`${a.mimeType} · ${size(a.size)}`}
                className="flex max-w-[260px] min-w-0 items-center gap-[6px] rounded-full border border-line-soft px-[10px] py-[5px] hover:bg-[#fafbf9]"
              >
                <Icon name={a.mimeType.startsWith("image/") ? "camera" : "doc"} size={13} className="shrink-0 text-body-soft" />
                <span className="truncate text-[12px] font-medium">{a.filename}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-faint">{size(a.size)}</span>
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <TableCard>
        {email.html ? (
          <EmailHtmlBody html={email.html} />
        ) : (
          <pre className="m-0 overflow-x-auto px-4 py-4 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-body">
            {email.text ?? "(This email has no body.)"}
          </pre>
        )}
      </TableCard>
    </PageBody>
  );
}
