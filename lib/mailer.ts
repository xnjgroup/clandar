/**
 * Clandar's own outgoing email (sign-in links and codes) — separate from the
 * Gmail connector, which sends as a person from their own mailbox and doesn't
 * exist before anyone has signed in. Any SMTP provider works (Resend, Postmark,
 * Amazon SES, Gmail with an app password …), configured either as separate values
 * (no escaping needed — passwords often contain ? @ : # …):
 *   SMTP_HOST, SMTP_PORT (465 = SSL, 587 = STARTTLS), SMTP_USER, SMTP_PASSWORD
 * or as one URL with its user and password percent-encoded:
 *   SMTP_URL    e.g. smtps://user%40example.com:pass@smtp.resend.com:465
 * plus the sender:
 *   EMAIL_FROM  e.g. "Clandar <no-reply@clandar.com>"
 * Without SMTP_URL in development, the message is printed to the server log
 * instead, so sign-in can still be tested locally.
 */
import nodemailer, { type Transporter } from "nodemailer";

// Cached with the settings it was built from, so changed SMTP settings (e.g. .env.local edited while
// `next dev` runs) builds a fresh transport instead of reusing stale credentials.
const globalForMailer = globalThis as typeof globalThis & { clandarMailer?: { url: string; transport: Transporter } };

/** The SMTP settings as a cache key / nodemailer config — separate values win over SMTP_URL. */
function smtpConfig(): { key: string; options: string | SMTPOptions } | null {
  const { SMTP_HOST: host, SMTP_PORT, SMTP_USER: user, SMTP_PASSWORD: pass, SMTP_URL: url } = process.env;
  if (host) {
    const port = Number(SMTP_PORT) || 465;
    return {
      key: `${host}|${port}|${user}|${pass}`,
      options: { host, port, secure: port === 465, auth: user ? { user, pass } : undefined },
    };
  }
  return url ? { key: url, options: url } : null;
}
type SMTPOptions = { host: string; port: number; secure: boolean; auth?: { user: string; pass?: string } };

export function mailerConfigured(): boolean {
  return Boolean(smtpConfig()) || process.env.NODE_ENV !== "production";
}

function transporter(): Transporter | null {
  const config = smtpConfig();
  if (!config) return null;
  if (globalForMailer.clandarMailer?.url !== config.key) {
    globalForMailer.clandarMailer = { url: config.key, transport: nodemailer.createTransport(config.options) };
  }
  return globalForMailer.clandarMailer.transport;
}

export async function sendSystemEmail(message: { to: string; subject: string; text: string; html: string }) {
  const transport = transporter();
  if (!transport) {
    if (process.env.NODE_ENV === "production") throw new Error("Email isn't configured (SMTP_HOST or SMTP_URL).");
    console.info(`[mailer] (no SMTP settings — not sent) To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
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
