/**
 * "Continue with email": a sign-in link and a 6-digit code in one email (the
 * link for the device that got the email, the code for any other). Both are
 * stored only as SHA-256 hashes, expire after 15 minutes and work once; the
 * code allows 5 tries. At most 3 emails per address per 10 minutes. Proving
 * the email signs in to that email's account (lib/auth.ts signInWithIdentity) —
 * the same account Google or Apple sign-in with that email reaches.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { sendSystemEmail } from "@/lib/mailer";

const TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_WINDOW = 3;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

/** Emails a sign-in link + code. Returns an error message for the person, or null when sent. */
export async function sendLoginEmail(email: string, origin: string): Promise<string | null> {
  const recent = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM email_login_codes
      WHERE lower(email) = $1 AND created_at > now() - interval '10 minutes'`,
    [email],
  );
  if ((recent?.n ?? 0) >= MAX_SENDS_PER_WINDOW) {
    return "We've sent a few codes already — wait a few minutes, or use the latest one.";
  }

  const token = randomBytes(32).toString("base64url");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await query(
    `INSERT INTO email_login_codes (email, token_hash, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [email, sha256(token), sha256(`${email}:${code}`), TTL_MINUTES],
  );

  // Opens a "Sign in" button rather than signing in on the GET, so mail scanners that open every
  // link (Outlook Safe Links …) don't use it up — see app/(auth)/login/email/page.tsx.
  const link = `${origin}/login/email?token=${token}`;
  await sendSystemEmail({
    to: email,
    subject: "Your Clandar sign-in link",
    text:
      `Sign in to Clandar: ${link}\n\nOr enter this code: ${code}\n\n` +
      `The link and code expire in ${TTL_MINUTES} minutes. If you didn't ask to sign in, ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#101211">
  <p>Sign in to Clandar:</p>
  <p><a href="${link}" style="display:inline-block;background:#101211;color:#d8f36a;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Sign in</a></p>
  <p>Or enter this code on the sign-in page:</p>
  <p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p>
  <p style="color:#6b7068">The link and code expire in ${TTL_MINUTES} minutes. If you didn't ask to sign in, you can ignore this email.</p>
</div>`,
  });
  return null;
}

/** The email a sign-in link is for, without using it up (for the confirm page) — or null if unknown, used or expired. */
export async function peekLoginLink(token: string): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const row = await queryOne<{ email: string }>(
    `SELECT email FROM email_login_codes WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  return row?.email ?? null;
}

/** The email a sign-in link proves, consuming it — or null if it's unknown, used or expired. */
export async function consumeLoginLink(token: string): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const row = await queryOne<{ email: string }>(
    `UPDATE email_login_codes SET consumed_at = now()
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING email`,
    [sha256(token)],
  );
  return row?.email ?? null;
}

/** Checks a typed code against the latest one sent to `email`. Returns true (consumed) or an error message. */
export async function consumeLoginCode(email: string, code: string): Promise<true | string> {
  const row = await queryOne<{ id: string; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM email_login_codes
      WHERE lower(email) = $1 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  if (!row) return "That code has expired — send a new one.";
  if (row.attempts >= MAX_ATTEMPTS) return "Too many tries — send a new code.";
  const given = Buffer.from(sha256(`${email}:${code.trim()}`));
  const expected = Buffer.from(row.code_hash);
  if (!/^\d{6}$/.test(code.trim()) || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    await query(`UPDATE email_login_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return "That code isn't right — check the email and try again.";
  }
  const consumed = await queryOne<{ id: string }>(
    `UPDATE email_login_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
    [row.id],
  );
  return consumed ? true : "That code was already used — send a new one.";
}
