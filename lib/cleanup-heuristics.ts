/**
 * Pure rules for spotting low-value mail worth trashing — no network, no
 * database, so they can be tested directly. `lib/gmail-cleanup.ts` runs
 * `isEligible` + `classify` over every scanned message first, and only spends
 * an LLM call on whatever passes — an inbox can be six figures of messages,
 * an LLM call per one is not.
 *
 * Deliberately conservative: unread, starred, and important mail is never a
 * candidate, and every rule needs an age floor. False negatives (missing a
 * junk email) cost nothing; false positives (flagging something that
 * mattered) cost trust in the whole feature.
 */
import type { ScannedMessage } from "@/lib/gmail";

export type Confidence = "low" | "medium" | "high";
export type HeuristicVerdict =
  | { candidate: true; reason: string; confidence: Confidence }
  | { candidate: false };

const AUTOMATED_SENDER =
  /^(no-?reply|do-?not-?reply|notifications?|newsletters?|updates?|marketing|mailer-daemon|news|info|hello|support)@/i;
const PROMO_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
const UNSUBSCRIBE = /\bunsubscribe\b/i;

function daysOld(date: Date | null): number {
  if (!date) return 0;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

/** `"Acme <billing@acme.test>"` → `billing@acme.test`, lowercased. */
function senderEmail(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match ? match[1] : from).trim().toLowerCase();
}

/**
 * Never a candidate regardless of content: the person hasn't read it yet,
 * marked it important, starred it, or it's already gone (trash/spam expire on
 * their own schedule and aren't this feature's job).
 */
export function isEligible(message: ScannedMessage): boolean {
  const skip = ["UNREAD", "STARRED", "IMPORTANT", "TRASH", "SPAM"];
  return !message.labels.some((l) => skip.includes(l));
}

export function classify(message: ScannedMessage): HeuristicVerdict {
  const age = daysOld(message.date);
  const promo = message.labels.some((l) => PROMO_LABELS.includes(l));
  const automated = AUTOMATED_SENDER.test(senderEmail(message.from));
  const unsubscribe = UNSUBSCRIBE.test(message.snippet);
  const signalCount = [promo, automated, unsubscribe].filter(Boolean).length;

  if (promo && automated && age > 90) {
    return {
      candidate: true,
      confidence: "high",
      reason: `Promotional mail from an automated sender, ${age} days old`,
    };
  }
  if (signalCount >= 2 && age > 60) {
    const signals = [promo && "promotions category", automated && "automated sender", unsubscribe && "unsubscribe link"]
      .filter(Boolean)
      .join(", ");
    return { candidate: true, confidence: "medium", reason: `Looks promotional (${signals}), ${age} days old` };
  }
  if (signalCount >= 1 && age > 180) {
    return {
      candidate: true,
      confidence: "low",
      reason: `Weak promotional signal, but ${age} days old and already read`,
    };
  }
  return { candidate: false };
}
