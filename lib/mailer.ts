/**
 * Clandar's own outgoing email (sign-in links and codes) — separate from the
 * Gmail connector, which sends as a person from their own mailbox and doesn't
 * exist before anyone has signed in. Any SMTP provider works (Resend, Postmark,
 * Amazon SES, Gmail with an app password …) via two env vars:
 *   SMTP_URL    e.g. smtps://user:pass@smtp.resend.com:465
 *   EMAIL_FROM  e.g. "Clandar <login@clandar.com>"
 * Without SMTP_URL in development, the message is printed to the server log
 * instead, so sign-in can still be tested locally.
 */
import nodemailer, { type Transporter } from "nodemailer";

const globalForMailer = globalThis as typeof globalThis & { clandarMailer?: Transporter };

export function mailerConfigured(): boolean {
  return Boolean(process.env.SMTP_URL) || process.env.NODE_ENV !== "production";
}

function transporter(): Transporter | null {
  if (!process.env.SMTP_URL) return null;
  if (!globalForMailer.clandarMailer) globalForMailer.clandarMailer = nodemailer.createTransport(process.env.SMTP_URL);
  return globalForMailer.clandarMailer;
}

export async function sendSystemEmail(message: { to: string; subject: string; text: string; html: string }) {
  const transport = transporter();
  if (!transport) {
    if (process.env.NODE_ENV === "production") throw new Error("Email isn't configured (SMTP_URL).");
    console.info(`[mailer] (no SMTP_URL — not sent) To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
    return;
  }
  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? "Clandar <no-reply@clandar.com>",
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
