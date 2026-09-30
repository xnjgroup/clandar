import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon, iconName } from "@/components/icons";
import { IconTile, PageBody, TableCard } from "@/components/ui";
import { LINE_TAG_CLASS, firstParam, longDate, money, shortDate } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { listInvoiceDocuments } from "@/lib/email-invoice";
import { listProjects } from "@/lib/projects";
import { AutoSubmitSelect } from "../../projects/[id]/auto-submit-select";
import { linkInvoiceProject, removeInvoice } from "../actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { invoiceDetail } from "@/lib/queries";

/** `?id=` pins one document; without it the vendor's latest invoice is shown. */
export default async function InvoiceDetailPage({
  params,
  searchParams,
}: PageProps<"/invoices/[vendor]">) {
  const { vendor: slug } = await params;
  const id = firstParam((await searchParams).id);
  const { org } = await requireSession();
  const invoice = await invoiceDetail(org.id, slug, id || undefined);
  if (!invoice) notFound();
  const [documents, projects] = await Promise.all([listInvoiceDocuments(invoice.id, org.id), listProjects(org.id)]);

  const flagged = invoice.status === "flagged";
  const overdue =
    invoice.dueDate !== null &&
    new Date(`${invoice.dueDate}T00:00:00`) < new Date() &&
    invoice.status !== "approved";

  const fields = [
    { label: "Account number", value: invoice.account ?? "—" },
    {
      label: "Billing period",
      value:
        invoice.periodStart && invoice.periodEnd
          ? `${shortDate(invoice.periodStart)} – ${shortDate(invoice.periodEnd)}`
          : "—",
    },
    { label: "Due date", value: invoice.dueDate ? longDate(invoice.dueDate) : "—" },
    { label: "Payment method", value: invoice.paymentMethod ?? "—" },
    { label: "Prior balance", value: money(invoice.priorBalance) },
    { label: "Late fee risk", value: overdue ? "Overdue" : "None" },
    {
      label: "Line items extracted",
      value: `${invoice.lineItemCount} of ${invoice.lineItemCount}`,
    },
  ];

  const approval =
    invoice.status === "approved"
      ? `Approved${invoice.approver ? ` · ${invoice.approver}` : ""}`
      : invoice.status === "rejected"
        ? `Rejected${invoice.approver ? ` · ${invoice.approver}` : ""}`
        : `Pending${invoice.approver ? ` · ${invoice.approver}` : ""}`;

  return (
    <PageBody>
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href="/invoices"
          aria-label="Back to invoices"
          className="flex size-[34px] shrink-0 items-center justify-center rounded-[12px] border border-line bg-surface"
        >
          <Icon name="chevL" size={18} />
        </Link>
        <Link href="/invoices" className="text-[13px] text-muted">
          Invoices
        </Link>
        <span className="text-[13px] text-[#c2c7bd]">/</span>
        <span className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.015em]">{invoice.vendor}</span>
        <div className="ml-auto shrink-0">
          <ConfirmDeleteButton
            action={removeInvoice}
            fields={{ invoiceId: invoice.id, projectId: invoice.projectId ?? "" }}
            title={`Delete this ${invoice.vendor} invoice?`}
            message={`The ${money(invoice.amount)} invoice from ${longDate(invoice.date)}, its line items and its source documents are deleted. This can't be undone.`}
          />
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-[14px]">
        <TableCard>
          <div className="flex flex-wrap items-center gap-[10px] border-b border-line-soft px-4 py-3">
            <span
              className={`rounded-full px-[9px] py-1 text-[11px] font-medium ${
                flagged ? "bg-bad-bg text-bad-fg" : "bg-ok-bg text-ok-fg"
              }`}
            >
              {flagged && invoice.flags.length > 0
                ? "flagged · needs resolution"
                : invoice.status.replace("_", " ")}
            </span>
            {invoice.confidence !== null ? (
              <span className="font-mono text-[10.5px] text-faint">
                OCR confidence {Math.round(invoice.confidence * 100)}%
              </span>
            ) : null}
          </div>

          <div className="flex justify-center overflow-x-auto bg-[#f7f8f6] p-5">
            <article className="flex w-full min-w-0 max-w-[560px] flex-col gap-[14px] rounded-[6px] border border-line bg-surface px-6 py-7 shadow-[0_4px_18px_rgba(16,18,17,0.07)]">
              <div className="flex items-baseline justify-between gap-[10px]">
                <span className="text-[16px] font-bold">{invoice.vendor}</span>
                <span className="font-mono text-[11px] text-faint">{longDate(invoice.date)}</span>
              </div>

              <div className="flex flex-wrap gap-[14px] text-[11.5px] text-muted">
                <span>
                  Master acct{" "}
                  <span className="font-mono text-ink">{invoice.account ?? "—"}</span>
                </span>
                {invoice.location ? (
                  <span>
                    Service location <span className="text-ink">{invoice.location}</span>
                  </span>
                ) : null}
              </div>

              <hr className="m-0 h-px border-0 bg-line-soft" />

              {invoice.groups.map((group) => (
                <div key={group.label} className="flex min-w-0 flex-col gap-[7px]">
                  <div className="flex min-w-0 items-center gap-[9px]">
                    <IconTile
                      icon={iconName(group.icon)}
                      size={26}
                      iconSize={15}
                      radius={9}
                      bg="#f2f4ef"
                      fg="#4c4f47"
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                      {group.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-faint">
                      {group.identifier ?? "—"}
                    </span>
                  </div>

                  {group.lines.map((line) => (
                    <div
                      key={`${line.tag}-${line.description}`}
                      className="flex min-w-0 items-baseline gap-[10px] pl-[31px]"
                    >
                      <span
                        className={`shrink-0 rounded-full px-[7px] py-[3px] font-mono text-[9.5px] ${
                          LINE_TAG_CLASS[line.tag]
                        }`}
                      >
                        {line.tag}
                      </span>
                      <span className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-[#3a3f39]">
                        {line.description}
                      </span>
                      <span className="shrink-0 font-mono text-[12.5px]">
                        {line.amount < 0 ? `−${money(Math.abs(line.amount))}` : money(line.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}

              <hr className="m-0 mt-1 h-px border-0 bg-line-soft" />
              <div className="flex items-baseline gap-[10px]">
                <span className="flex-1 text-[14px] font-bold">Total due</span>
                <span className="font-mono text-[15px] font-bold">{money(invoice.amount)}</span>
              </div>
            </article>
          </div>
        </TableCard>

        <div className="flex min-w-0 flex-col gap-3">
          <section className="flex min-w-0 flex-col gap-[11px] rounded-[20px] border border-line bg-surface p-[17px]">
            <div className="flex flex-wrap items-center gap-[9px]">
              <h2 className="m-0 text-[14.5px] font-bold tracking-[-0.02em]">Extracted fields</h2>
              <span className="rounded-full bg-ok-bg px-2 py-1 font-mono text-[10px] text-ok-fg">
                {invoice.submittedBy}
              </span>
            </div>
            <dl className="m-0 flex flex-col">
              {fields.map((field) => (
                <div
                  key={field.label}
                  className="flex min-w-0 items-baseline gap-[9px] border-b border-line-faint py-[9px]"
                >
                  <dt className="shrink-0 text-[12px] text-muted">{field.label}</dt>
                  <span className="min-w-[10px] flex-1 border-b border-dotted border-[#e0e3dd]" />
                  <dd className="m-0 text-right text-[12.5px] font-medium break-words">
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="flex min-w-0 flex-col gap-[11px] rounded-[20px] border border-line bg-surface p-[17px]">
            <h2 className="m-0 text-[14.5px] font-bold tracking-[-0.02em]">Categorization</h2>
            <div className="flex flex-wrap items-center gap-[9px]">
              <span className="rounded-full bg-[#eaf3d8] px-[9px] py-1 font-mono text-[11px] text-[#41631a]">
                {invoice.category}
              </span>
              <span className="text-[11.5px] text-muted">from the vendor record</span>
            </div>
            <p className="m-0 text-[11.5px] leading-[1.5] text-muted">
              {invoice.nextDue
                ? `Recurring — matched to an existing subscription. Next expected charge ${shortDate(invoice.nextDue)}.`
                : "One-time charge — no recurring subscription matched for this vendor."}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="cursor-pointer rounded-full border border-line px-[13px] py-[7px] text-[12px] font-medium"
              >
                Recategorize
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-full border border-line px-[13px] py-[7px] text-[12px] font-medium"
              >
                Mark as one-time
              </button>
            </div>
          </section>

          <section className="flex min-w-0 flex-col gap-[9px] rounded-[20px] border border-line bg-surface p-[17px]">
            <h2 className="m-0 text-[14.5px] font-bold tracking-[-0.02em]">Project</h2>
            <form action={linkInvoiceProject} className="flex flex-col gap-[6px]">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <AutoSubmitSelect
                name="projectId"
                defaultValue={invoice.projectId ?? ""}
                className="w-full rounded-[12px] border border-line bg-surface px-3 py-[9px] text-[12.5px] text-ink"
              >
                <option value="">Not linked to a project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} — {p.customerName}
                  </option>
                ))}
              </AutoSubmitSelect>
            </form>
            {invoice.projectId ? (
              <Link href={`/projects/${invoice.projectId}`} className="text-[12px] font-medium underline">
                Open {invoice.projectTitle ?? "project"} →
              </Link>
            ) : (
              <span className="text-[11.5px] text-muted">Link it to charge this spend to a job.</span>
            )}
          </section>

          {documents.length > 0 ? (
            <section className="flex min-w-0 flex-col gap-[9px] rounded-[20px] border border-line bg-surface p-[17px]">
              <h2 className="m-0 text-[14.5px] font-bold tracking-[-0.02em]">Source documents</h2>
              {documents.map((doc) => (
                <a
                  key={doc.id}
                  // The original email opens in the in-app viewer; PDFs/images open as themselves.
                  href={
                    doc.contentType === "message/rfc822"
                      ? `/invoices/${invoice.slug}/source/${doc.id}?invoice=${invoice.id}`
                      : `/api/invoices/${invoice.id}/documents/${doc.id}`
                  }
                  target={doc.contentType === "message/rfc822" ? undefined : "_blank"}
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-[10px] rounded-[14px] border border-line-soft px-[12px] py-[9px] hover:bg-[#fafbf9]"
                >
                  <Icon name={doc.contentType === "message/rfc822" ? "mail" : "doc"} size={15} className="shrink-0 text-body-soft" />
                  <span className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                    <span className="truncate text-[12.5px] font-medium">{doc.fileName}</span>
                    <span className="truncate text-[11px] text-muted">
                      {doc.contentType === "message/rfc822" ? "Original email" : doc.contentType} ·{" "}
                      {doc.sizeBytes < 1024 * 1024
                        ? `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB`
                        : `${(doc.sizeBytes / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] font-medium underline">
                    {doc.contentType === "message/rfc822" ? "View" : "Open"}
                  </span>
                </a>
              ))}
            </section>
          ) : null}

          <section className="flex min-w-0 flex-col gap-[10px] rounded-[20px] bg-ink p-[17px]">
            <h2 className="m-0 text-[14.5px] font-bold tracking-[-0.02em] text-bg">Approval</h2>
            <div className="flex items-baseline gap-[9px]">
              <span className="text-[12.5px] text-[#8d938a]">Status</span>
              <span className="flex-1 border-b border-dotted border-[#2c302b]" />
              <span className="font-mono text-[11.5px] text-bg">{approval}</span>
            </div>

            {invoice.flags.length > 0 ? (
              <div className="flex flex-col gap-[6px]">
                <span className="font-mono text-[10px] tracking-[0.08em] text-[#8d938a] uppercase">
                  Blocking flags
                </span>
                {invoice.flags.map((flag) => (
                  <div key={flag.id} className="flex min-w-0 items-baseline gap-[9px]">
                    <Icon name="alertSm" size={13} className="shrink-0 text-[#e8a23d]" />
                    <span className="min-w-0 flex-1 text-[12px] leading-[1.5] text-bg">
                      {flag.label}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer text-[11px] font-medium text-lime underline"
                    >
                      Clear
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={invoice.flags.length > 0}
                title={invoice.flags.length > 0 ? "Clear all flags before approving" : undefined}
                className="rounded-full bg-lime px-[14px] py-2 text-[12px] font-semibold text-ink enabled:cursor-pointer disabled:cursor-not-allowed disabled:bg-[#3b3f37] disabled:text-muted"
              >
                Approve
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-full border border-[#3b3f37] px-[14px] py-2 text-[12px] font-semibold text-bg"
              >
                Reject
              </button>
            </div>
          </section>
        </div>
      </div>
    </PageBody>
  );
}
