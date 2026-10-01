/**
 * The people in an org and invites to it — shared by the Settings page's actions and /api/v1/settings.
 */
import { sendMail, sendableGmailConnectorId } from "@/lib/gmail";

export const ROLES = ["owner", "approver", "member", "crew"];

const ROLE_NAMES: Record<string, string> = { owner: "an owner", approver: "an approver", member: "a member", crew: "crew" };

/**
 * Emails an invite from the org's first Gmail connector that's allowed to
 * send. Joining needs nothing but signing in with the invited account
 * (the pending invite is matched by email), so the email is just that link.
 * Never throws — a missing connector or a Gmail error comes back as `why`,
 * phrased for the person who sent the invite, with the link to share by hand.
 */
export async function sendInviteEmail(invite: {
  orgId: string;
  orgName: string;
  inviter: string;
  email: string;
  role: string;
  /** The site's origin, for the sign-in link. */
  origin: string;
}): Promise<{ ok: true } | { ok: false; why: string }> {
  const signInUrl = `${invite.origin}/login`;
  const manual = `Share this sign-in link with them: ${signInUrl}`;

  const connectorId = await sendableGmailConnectorId(invite.orgId);
  if (!connectorId) return { ok: false, why: `No email was sent — connect a Gmail account with send access on /connectors to email invites. ${manual}` };

  try {
    await sendMail({
      orgId: invite.orgId,
      connectorId,
      to: invite.email,
      subject: `${invite.inviter} invited you to join ${invite.orgName}`,
      body: [
        `Hi,`,
        ``,
        `${invite.inviter} has invited you to join ${invite.orgName} on Clandar as ${ROLE_NAMES[invite.role] ?? invite.role}.`,
        ``,
        `To accept, sign in with your account for ${invite.email}:`,
        signInUrl,
        ``,
        `You'll be added to ${invite.orgName} automatically the first time you sign in. If you weren't expecting this, you can ignore this email.`,
      ].join("\n"),
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      why: `The invitation email couldn't be sent (${error instanceof Error ? error.message : "unknown error"}). ${manual}`,
    };
  }
}
