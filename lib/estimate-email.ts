/**
 * Renders the estimate email a customer receives — company header, the
 * sender's message, the line-item table, totals — as HTML plus a plain-text
 * alternative. Pure (no DB/server imports) so the send dialog's live preview
 * and the server's actual send use the exact same output; the server always
 * re-renders from the saved estimate rather than trusting HTML from the browser.
 */

export type Letterhead = {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Contractor license / registration number, shown small under the name. */
  license: string;
};

export const EMPTY_LETTERHEAD: Letterhead = {
  companyName: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  license: "",
};

export type EmailEstimate = {
  summary: string;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: { description: string; quantity: number; unitPrice: number; kind: string }[];
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Blank-line-separated paragraphs, single newlines kept as line breaks. */
const paragraphs = (text: string, style: string) =>
  text
    .trim()
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p style="${style}">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");

export function defaultEstimateMessage(customerName: string, projectTitle: string): string {
  const first = customerName.trim().split(/\s+/)[0] || "there";
  return `Hi ${first},\n\nThank you for the opportunity to quote ${projectTitle}. Please find the estimate below. Let me know if you have any questions, or reply to schedule the work.`;
}

export function renderEstimateEmail(input: {
  letterhead: Letterhead;
  message: string;
  projectTitle: string;
  estimate: EmailEstimate;
  attachmentNames?: string[];
}): { html: string; text: string } {
  const { letterhead: lh, message, projectTitle, estimate } = input;
  const contact = [lh.address, lh.phone, lh.email, lh.website].map((s) => s.trim()).filter(Boolean);
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

  const header = lh.companyName.trim()
    ? `<tr><td style="padding:24px 28px 18px;border-bottom:3px solid #1f231c">
        <div style="font-size:20px;font-weight:700;color:#1f231c">${escapeHtml(lh.companyName.trim())}</div>
        ${lh.license.trim() ? `<div style="font-size:11px;color:#6b7065;margin-top:2px">${escapeHtml(lh.license.trim())}</div>` : ""}
        ${contact.length ? `<div style="font-size:12px;color:#4c4f47;margin-top:8px;line-height:1.6">${contact.map(escapeHtml).join(" &nbsp;·&nbsp; ")}</div>` : ""}
      </td></tr>`
    : "";

  const rows = estimate.lineItems
    .map(
      (li) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #ecefe8;font-size:13px;color:#1f231c">${escapeHtml(li.description)}
          <div style="font-size:11px;color:#8a8f84;text-transform:capitalize">${escapeHtml(li.kind)}</div></td>
        <td style="padding:8px 0;border-bottom:1px solid #ecefe8;font-size:13px;color:#4c4f47;text-align:right;white-space:nowrap">${li.quantity} × ${money(li.unitPrice)}</td>
        <td style="padding:8px 0 8px 14px;border-bottom:1px solid #ecefe8;font-size:13px;color:#1f231c;text-align:right;white-space:nowrap">${money(li.quantity * li.unitPrice)}</td>
      </tr>`,
    )
    .join("");
  const totalRow = (label: string, value: number, strong = false) =>
    `<tr><td colspan="2" style="padding:6px 0;font-size:13px;text-align:right;color:${strong ? "#1f231c" : "#4c4f47"};${strong ? "font-weight:700" : ""}">${label}</td>
      <td style="padding:6px 0 6px 14px;font-size:${strong ? 15 : 13}px;text-align:right;white-space:nowrap;color:#1f231c;${strong ? "font-weight:700" : ""}">${money(value)}</td></tr>`;

  const attachments = input.attachmentNames?.length
    ? `<p style="margin:18px 0 0;font-size:12px;color:#6b7065">Attached: ${input.attachmentNames.map(escapeHtml).join(", ")}</p>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f5f1;${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e5dd;border-radius:14px;border-collapse:separate;overflow:hidden">
${header}
<tr><td style="padding:22px 28px 26px">
  ${paragraphs(message, "margin:0 0 12px;font-size:14px;line-height:1.6;color:#1f231c")}
  <div style="margin:20px 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7065">Estimate — ${escapeHtml(projectTitle)}</div>
  ${estimate.summary.trim() ? paragraphs(estimate.summary, "margin:0 0 10px;font-size:13px;line-height:1.55;color:#4c4f47") : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px">
    ${rows}
    ${totalRow("Subtotal", estimate.subtotal)}
    ${estimate.tax > 0 ? totalRow("Tax", estimate.tax) : ""}
    ${totalRow("Total", estimate.total, true)}
  </table>
  ${attachments}
</td></tr>
</table></body></html>`;

  const text = [
    lh.companyName.trim(),
    lh.license.trim(),
    contact.join(" · "),
    lh.companyName.trim() ? "" : null,
    message.trim(),
    "",
    `ESTIMATE — ${projectTitle}`,
    estimate.summary.trim(),
    "",
    ...estimate.lineItems.map(
      (li) => `- ${li.description} (${li.kind}): ${li.quantity} x ${money(li.unitPrice)} = ${money(li.quantity * li.unitPrice)}`,
    ),
    "",
    `Subtotal: ${money(estimate.subtotal)}`,
    estimate.tax > 0 ? `Tax: ${money(estimate.tax)}` : null,
    `Total: ${money(estimate.total)}`,
    input.attachmentNames?.length ? `\nAttached: ${input.attachmentNames.join(", ")}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { html, text };
}
