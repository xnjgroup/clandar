import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { IconTile, PageBody, TableCard } from "@/components/ui";
import { INVOICE_DETAIL, INVOICE_SLUGS, LINE_TAG_CLASS } from "@/lib/data";

export function generateStaticParams() {
  return Object.keys(INVOICE_SLUGS).map((vendor) => ({ vendor }));
}

export default async function InvoiceDetailPage({ params }: PageProps<"/invoices/[vendor]">) {
  const { vendor } = await params;
  const name = INVOICE_SLUGS[vendor];
  if (!name) notFound();

  /* The Comcast document is the one carrying duplicate-charge flags. */
  const flagged = name === "Comcast Business";
  const flags = flagged ? INVOICE_DETAIL.flags : [];

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
        <span className="text-[14px] font-semibold tracking-[-0.015em]">{name}</span>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-[14px]">
        <TableCard>
          <div className="flex flex-wrap items-center gap-[10px] border-b border-line-soft px-4 py-3">
            <span
              className={`rounded-full px-[9px] py-1 text-[11px] font-medium ${
                flagged ? "bg-bad-bg text-bad-fg" : "bg-ok-bg text-ok-fg"
              }`}
            >
              {flagged ? "flagged · duplicate suspected" : "extracted"}
            </span>
            <span className="font-mono text-[10.5px] text-faint">
              OCR confidence {INVOICE_DETAIL.confidence}
            </span>
          </div>

          <div className="flex justify-center overflow-x-auto bg-[#f7f8f6] p-5">
            <article className="flex w-full min-w-0 max-w-[560px] flex-col gap-[14px] rounded-[6px] border border-line bg-surface px-6 py-7 shadow-[0_4px_18px_rgba(16,18,17,0.07)]">
              <div className="flex items-baseline justify-between gap-[10px]">
                <span className="text-[16px] font-bold">{name}</span>
                <span className="font-mono text-[11px] text-faint">{INVOICE_DETAIL.date}</span>
              </div>

              <div className="flex flex-wrap gap-[14px] text-[11.5px] text-muted">
                <span>
                  Master acct{" "}
                  <span className="font-mono text-ink">{INVOICE_DETAIL.account}</span>
                </span>
                <span>
                  Service location <span className="text-ink">{INVOICE_DETAIL.location}</span>
                </span>
              </div>

              <hr className="m-0 h-px border-0 bg-line-soft" />

              {INVOICE_DETAIL.assets.map((asset) => (
                <div key={asset.identifier} className="flex min-w-0 flex-col gap-[7px]">
                  <div className="flex min-w-0 items-center gap-[9px]">
                    <IconTile
                      icon={asset.icon}
                      size={26}
                      iconSize={15}
                      radius={9}
                      bg="#f2f4ef"
                      fg="#4c4f47"
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                      {asset.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-faint">
                      {asset.identifier}
                    </span>
                  </div>

                  {asset.lines.map((line) => (
                    <div
                      key={line.desc}
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
                        {line.desc}
                      </span>
                      <span className="shrink-0 font-mono text-[12.5px]">{line.amount}</span>
                    </div>
                  ))}
                </div>
              ))}

              <hr className="m-0 mt-1 h-px border-0 bg-line-soft" />
              <div className="flex items-baseline gap-[10px]">
                <span className="flex-1 text-[14px] font-bold">Total due</span>
                <span className="font-mono text-[15px] font-bold">{INVOICE_DETAIL.total}</span>
              </div>
            </article>
          </div>
        </TableCard>

        <div className="flex min-w-0 flex-col gap-3">
          <section className="flex min-w-0 flex-col gap-[11px] rounded-[20px] border border-line bg-surface p-[17px]">
            <div className="flex flex-wrap items-center gap-[9px]">
              <h2 className="m-0 text-[14.5px] font-bold tracking-[-0.02em]">Extracted fields</h2>
              <span className="rounded-full bg-ok-bg px-2 py-1 font-mono text-[10px] text-ok-fg">
                skill · v4
              </span>
            </div>
            <dl className="m-0 flex flex-col">
              {INVOICE_DETAIL.fields.map((field) => (
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
                {INVOICE_DETAIL.category}
              </span>
              <span className="text-[11.5px] text-muted">auto-detected, 96% confidence</span>
            </div>
            <p className="m-0 text-[11.5px] leading-[1.5] text-muted">
              Recurring — matched to an existing subscription. Next expected charge ~
              {INVOICE_DETAIL.nextDue}.
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

          <section className="flex min-w-0 flex-col gap-[10px] rounded-[20px] bg-ink p-[17px]">
            <h2 className="m-0 text-[14.5px] font-bold tracking-[-0.02em] text-bg">Approval</h2>
            <div className="flex items-baseline gap-[9px]">
              <span className="text-[12.5px] text-[#8d938a]">Status</span>
              <span className="flex-1 border-b border-dotted border-[#2c302b]" />
              <span className="font-mono text-[11.5px] text-bg">{INVOICE_DETAIL.approver}</span>
            </div>

            {flags.length > 0 ? (
              <div className="flex flex-col gap-[6px]">
                <span className="font-mono text-[10px] tracking-[0.08em] text-[#8d938a] uppercase">
                  Blocking flags
                </span>
                {flags.map((flag) => (
                  <div key={flag.label} className="flex min-w-0 items-baseline gap-[9px]">
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
                disabled={flagged}
                title={flagged ? "Clear all flags before approving" : undefined}
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
