/**
 * Authentication: Google sign-in, database-backed sessions, and multi-tenant
 * org resolution. This is the app's Data Access Layer (DAL) — every page,
 * Server Action and Route Handler that needs to know who's signed in (or
 * which org their data belongs to) calls `requireSession()`/`requireOrgId()`
 * here, rather than reading the session cookie itself.
 *
 * Distinct from `lib/connectors.ts`'s Google OAuth: that flow requests
 * long-lived API access (Gmail/Calendar scopes) for a *connector* row and
 * stores refresh tokens. This flow only proves who the person is
 * (`openid email profile`) and never stores a Google token at all — once the
 * profile is read, a plain server-side session takes over.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { query, queryOne, transaction } from "@/lib/db";
import { googleCredentials } from "@/lib/connectors";
import { seedProjectTypes } from "@/lib/project-types";
import { deleteUpload } from "@/lib/storage";

const SESSION_COOKIE = "clandar_session";
const STATE_COOKIE = "clandar_oauth_state";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_TIMEOUT_MS = 10_000;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function sessionSecret(): Uint8Array {
  // Falls back to APP_ENCRYPTION_KEY so a fresh checkout with that one
  // variable set already has working sessions — set SESSION_SECRET
  // explicitly to rotate sessions independently of connector secrets.
  const raw = process.env.SESSION_SECRET || process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SESSION_SECRET (or APP_ENCRYPTION_KEY) must be set in .env.local to sign sessions",
    );
  }
  return new TextEncoder().encode(raw);
}

/* ── Session cookie: signed JWT wrapping a database session id ────────── */

async function signSessionToken(sessionId: string, expiresAt: Date): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(sessionSecret());
}

async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null; // expired, tampered, or signed with a since-rotated secret
  }
}

/** A native app's session lasts longer than the web's — people don't expect to sign in to an app monthly. */
const APP_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** A new session row and its signed token — the web sets it as a cookie, the iOS app keeps it in the Keychain. */
async function issueSession(personId: string, ttlMs: number): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO sessions (person_id, expires_at) VALUES ($1, $2) RETURNING id`,
    [personId, expiresAt],
  );
  return { token: await signSessionToken(row!.id, expiresAt), expiresAt };
}

async function createSession(personId: string): Promise<void> {
  const { token, expiresAt } = await issueSession(personId, SESSION_TTL_MS);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const sid = await verifySessionToken(token);
    if (sid) await query(`DELETE FROM sessions WHERE id = $1`, [sid]);
  }
  jar.delete(SESSION_COOKIE);
}

/** `"use server"` wrapper so a client component (the sidebar's user menu) can submit a plain form to it. */
export async function signOutAction() {
  "use server";
  await signOut();
  redirect("/");
}

/* ── Session lookup (the DAL) ─────────────────────────────────────────── */

export type SessionInfo = {
  person: { id: string; name: string; email: string; role: string; avatarUrl: string | null };
  /** assistantName: what the team calls its assistant (Clandar unless renamed in Settings). */
  org: { id: string; name: string; onboarded: boolean; assistantName: string };
};

type SessionRow = {
  person_id: string;
  name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  org_id: string;
  org_name: string;
  org_onboarded: boolean;
  org_assistant_name: string;
};

/**
 * The session token for this request: `Authorization: Bearer <token>` (the iOS app) or the session
 * cookie (the web). Same signed token either way, checked against the `sessions` row, so revoking a
 * session works for both.
 */
async function sessionTokenFromRequest(): Promise<string | null> {
  const auth = (await headers()).get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim() || null;
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Reads the session cookie without redirecting — for the few places that
 * behave differently when signed out (the login page itself, which redirects
 * *away* to "/" if a session already exists). `cache()` memoizes this for the
 * lifetime of one request, so calling it from both the layout and a page
 * costs one query, not two.
 */
export const currentSession = cache(async (): Promise<SessionInfo | null> => {
  const token = await sessionTokenFromRequest();
  if (!token) return null;
  const sid = await verifySessionToken(token);
  if (!sid) return null;

  const row = await queryOne<SessionRow>(
    `SELECT p.id AS person_id, p.name, p.email, p.role, p.avatar_url,
            o.id AS org_id, o.name AS org_name, o.onboarded AS org_onboarded,
            o.assistant_name AS org_assistant_name
       FROM sessions s
       JOIN people p ON p.id = s.person_id
       JOIN organizations o ON o.id = p.org_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sid],
  );
  if (!row) return null;

  return {
    person: {
      id: row.person_id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatarUrl: row.avatar_url,
    },
    org: {
      id: row.org_id,
      name: row.org_name,
      onboarded: row.org_onboarded,
      assistantName: row.org_assistant_name,
    },
  };
});

/**
 * The DAL primitive: every page (via the dashboard layout), Server Action and
 * Route Handler that touches org-scoped data calls this. Redirects to
 * `/login` when there's no valid session — pages get this for free from the
 * layout, but Server Actions and Route Handlers bypass layouts entirely, so
 * they must call it themselves too (see the Next.js authentication guide's
 * guidance on treating each as its own entry point).
 */
/* ── Where to go after signing in ─────────────────────────── */

const AFTER_SIGN_IN_COOKIE = "clandar_after_sign_in";

/** Only a path on this site (never another host, never the sign-in pages themselves). */
function safeReturnPath(path: string | undefined): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  if (path === "/" || path.startsWith("/login")) return null;
  return path;
}

/** Remember a page to come back to once signed in (e.g. an AI agent's "Allow access" screen). */
export async function rememberAfterSignIn(path: string): Promise<void> {
  const safe = safeReturnPath(path);
  if (!safe) return;
  (await cookies()).set(AFTER_SIGN_IN_COOKIE, safe, {
    httpOnly: true,
    // "none": Apple's sign-in comes back as a cross-site POST, which doesn't carry lax cookies.
    sameSite: "none",
    secure: true,
    path: "/",
    maxAge: 15 * 60,
  });
}

/** Where to go now that sign-in is done: the remembered page (once), else Overview. */
export async function takeAfterSignIn(): Promise<string> {
  const jar = await cookies();
  const path = safeReturnPath(jar.get(AFTER_SIGN_IN_COOKIE)?.value);
  if (path) jar.delete(AFTER_SIGN_IN_COOKIE);
  return path ?? "/overview";
}

export async function requireSession(): Promise<SessionInfo> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}

/** Shorthand for the common case of just needing the tenant to scope a query by. */
export async function requireOrgId(): Promise<string> {
  return (await requireSession()).org.id;
}

/** Back-compat shape for the handful of call sites written before real auth existed. */
export async function currentPerson(): Promise<SessionInfo["person"] | null> {
  return (await currentSession())?.person ?? null;
}

/* ── Google sign-in ────────────────────────────────────────────────────── */

function loginRedirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

/** Builds the consent URL and stashes a CSRF token in a short-lived cookie, checked by `verifyLoginState`. */
export async function startGoogleLogin(origin: string): Promise<string> {
  const { clientId } = googleCredentials();
  const state = crypto.randomUUID();

  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", loginRedirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function verifyLoginState(state: string): Promise<boolean> {
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  return Boolean(expected) && expected === state;
}

type GoogleProfile = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

/** The label a brand-new org gets when nobody named it yet — from the signer's email domain, e.g. "acme.com" → "Acme". */
/** Free/personal email providers — the domain says nothing about the business, so guessing a name from it would be actively wrong (e.g. "Gmail"). */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "yandex.com",
  "mail.com",
]);

/** A starting guess for a brand-new org's name — the /onboarding form's pre-filled value, not the final name. */
function orgNameFromEmail(email: string): string {
  const domain = (email.split("@")[1] ?? "").toLowerCase();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return "My Company";
  const label = domain.split(".")[0] || "My Company";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Who someone proved to be, by any sign-in method. `email` is always verified by that method. */
export type LoginIdentity = {
  provider: "google" | "apple" | "email";
  /** The provider's stable user id (Google's / Apple's `sub`); none for email. */
  sub?: string;
  email: string;
  name?: string | null;
  picture?: string | null;
};

const SUB_COLUMN = { google: "google_sub", apple: "apple_sub" } as const;

/**
 * Finds or creates the `people` row for a sign-in, resolving which org it belongs to:
 *  1. This provider's account has signed in before — reuse it.
 *  2. Someone with this verified email has signed in before (by any method) — the same person:
 *     link this method to them. (One account per email, whether they use Google, Apple or email.)
 *  3. A pending invite for this email — join that org with the invited role.
 *  4. Nobody has ever signed in yet — claim the bootstrap org (the one pre-existing
 *     connectors/LLM providers were migrated onto), as its owner.
 *  5. Otherwise — a brand-new signup with no invite: a fresh, isolated org, as its owner.
 */
async function resolvePersonForLogin(identity: LoginIdentity): Promise<string> {
  const subColumn = identity.provider === "email" ? null : SUB_COLUMN[identity.provider];
  const name = identity.name?.trim() || null;

  if (subColumn && identity.sub) {
    const existing = await queryOne<{ id: string }>(`SELECT id FROM people WHERE ${subColumn} = $1`, [identity.sub]);
    if (existing) {
      await query(
        `UPDATE people SET last_login_at = now(), name = coalesce($2, name), avatar_url = coalesce($3, avatar_url)
          WHERE id = $1`,
        [existing.id, name, identity.picture ?? null],
      );
      return existing.id;
    }
  }

  const sameEmail = await queryOne<{ id: string }>(
    `SELECT id FROM people WHERE lower(email) = lower($1) AND last_login_at IS NOT NULL
      ORDER BY last_login_at DESC LIMIT 1`,
    [identity.email],
  );
  if (sameEmail) {
    await query(
      `UPDATE people SET last_login_at = now(), avatar_url = coalesce(avatar_url, $2)
              ${subColumn ? `, ${subColumn} = coalesce(${subColumn}, $3)` : ""}
        WHERE id = $1`,
      subColumn ? [sameEmail.id, identity.picture ?? null, identity.sub ?? null] : [sameEmail.id, identity.picture ?? null],
    );
    return sameEmail.id;
  }

  const displayName = name || identity.email;
  const subs = {
    google: identity.provider === "google" ? (identity.sub ?? null) : null,
    apple: identity.provider === "apple" ? (identity.sub ?? null) : null,
  };
  return transaction(async (client) => {
    const insertPerson = async (role: string, orgId: string) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO people (name, email, role, org_id, google_sub, apple_sub, avatar_url, last_login_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
          [displayName, identity.email, role, orgId, subs.google, subs.apple, identity.picture ?? null],
        )
      ).rows[0].id;

    const invite = await client.query<{ id: string; org_id: string; role: string }>(
      `SELECT id, org_id, role FROM org_invites WHERE lower(email) = lower($1) AND accepted_at IS NULL`,
      [identity.email],
    );
    if (invite.rows[0]) {
      const inv = invite.rows[0];
      const id = await insertPerson(inv.role, inv.org_id);
      await client.query(`UPDATE org_invites SET accepted_at = now() WHERE id = $1`, [inv.id]);
      return id;
    }

    const anyRealAccount = await client.query(`SELECT 1 FROM people WHERE last_login_at IS NOT NULL LIMIT 1`);
    let orgId: string;
    if (anyRealAccount.rows.length === 0) {
      const bootstrap = await client.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`);
      orgId =
        bootstrap.rows[0]?.id ??
        (
          await client.query<{ id: string }>(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [
            orgNameFromEmail(identity.email),
          ])
        ).rows[0].id;
    } else {
      orgId = (
        await client.query<{ id: string }>(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [
          orgNameFromEmail(identity.email),
        ])
      ).rows[0].id;
    }
    return insertPerson("owner", orgId);
  });
}

/** The iOS app's sign-in: the same account resolution, but the session comes back as a token (no cookie). */
export async function signInForApp(identity: LoginIdentity): Promise<{ token: string; expiresAt: Date }> {
  const personId = await resolvePersonForLogin(identity);
  return issueSession(personId, APP_SESSION_TTL_MS);
}

/** Ends the session behind this request's bearer token or cookie (the app's Sign out). */
export async function revokeCurrentSession(): Promise<void> {
  const token = await sessionTokenFromRequest();
  const sid = token ? await verifySessionToken(token) : null;
  if (sid) await query(`DELETE FROM sessions WHERE id = $1`, [sid]);
}

/** Signs someone in by any method: resolves (or creates) their account and starts a session. */
export async function signInWithIdentity(identity: LoginIdentity): Promise<void> {
  const personId = await resolvePersonForLogin(identity);
  await createSession(personId);
}

type GoogleTokens = { access_token: string; id_token?: string };

/** Exchanges the code, reads the verified profile from Google's own userinfo endpoint, and starts a session. */
export async function completeGoogleLogin(code: string, origin: string): Promise<void> {
  const { clientId, clientSecret } = googleCredentials();

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: loginRedirectUri(origin),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
  });
  const tokens = (await tokenResponse.json()) as GoogleTokens & { error?: string; error_description?: string };
  if (!tokenResponse.ok) {
    throw new Error(tokens.error_description ?? tokens.error ?? "Google did not return a token");
  }

  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
  });
  if (!profileResponse.ok) throw new Error("Could not read your Google profile");
  const profile = (await profileResponse.json()) as GoogleProfile;
  if (!profile.email) throw new Error("Google did not share an email address");
  if (profile.email_verified === false) throw new Error("That Google account's email isn't verified");

  await signInWithIdentity({
    provider: "google",
    sub: profile.sub,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
  });
}

/* ── Team (invites) ───────────────────────────────────────────────────── */

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  lastLoginAt: Date | null;
};

export async function listTeam(orgId: string): Promise<TeamMember[]> {
  const rows = await query<{ id: string; name: string; email: string; role: string; last_login_at: Date | null }>(
    `SELECT id, name, email, role, last_login_at FROM people
      WHERE org_id = $1 ORDER BY (role = 'owner') DESC, name`,
    [orgId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, lastLoginAt: r.last_login_at }));
}

export type PendingInvite = { id: string; email: string; role: string; createdAt: Date };

export async function listPendingInvites(orgId: string): Promise<PendingInvite[]> {
  const rows = await query<{ id: string; email: string; role: string; created_at: Date }>(
    `SELECT id, email, role, created_at FROM org_invites
      WHERE org_id = $1 AND accepted_at IS NULL ORDER BY created_at DESC`,
    [orgId],
  );
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at }));
}

export async function inviteTeammate(
  orgId: string,
  invitedBy: string,
  email: string,
  role: string,
): Promise<void> {
  await query(
    `INSERT INTO org_invites (org_id, email, role, invited_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (lower(email)) WHERE accepted_at IS NULL
       DO UPDATE SET org_id = excluded.org_id, role = excluded.role,
                      invited_by = excluded.invited_by, created_at = now()`,
    [orgId, email.trim().toLowerCase(), role, invitedBy],
  );
}

export async function revokeInvite(orgId: string, inviteId: string): Promise<void> {
  await query(`DELETE FROM org_invites WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL`, [
    inviteId,
    orgId,
  ]);
}

export async function updateTeammateRole(orgId: string, personId: string, role: string): Promise<void> {
  await query(`UPDATE people SET role = $3 WHERE id = $1 AND org_id = $2`, [personId, orgId, role]);
}

export async function removeTeammate(orgId: string, personId: string): Promise<void> {
  await query(`DELETE FROM people WHERE id = $1 AND org_id = $2 AND role != 'owner'`, [personId, orgId]);
}

/** Renames the organization itself — shown in the sidebar and Settings, e.g. replacing the auto-generated "My Company"/email-domain default. */
export async function updateOrgName(orgId: string, name: string): Promise<void> {
  await query(`UPDATE organizations SET name = $2 WHERE id = $1`, [orgId, name]);
}

/** The assistant's name rule: one word — letters and numbers only — of at most 10 characters. */
export const ASSISTANT_NAME_PATTERN = /^[\p{L}\p{N}]{1,10}$/u;

export async function updateAssistantName(orgId: string, name: string): Promise<void> {
  await query(`UPDATE organizations SET assistant_name = $2 WHERE id = $1`, [orgId, name]);
}

/** The one-time first-sign-in step: names the org and clears the flag that sends its owner to /onboarding. */
export async function completeOnboarding(orgId: string, name: string, companyType: string): Promise<void> {
  await query(`UPDATE organizations SET name = $2, company_type = $3, onboarded = true WHERE id = $1`, [
    orgId,
    name,
    companyType,
  ]);
  await seedProjectTypes(orgId, companyType);
}

/**
 * Permanently deletes an org and everything in it — every table with an
 * `org_id` column cascades from the `organizations` row (see db/schema.sql),
 * so the only thing that needs doing by hand first is the actual bytes on
 * disk for project photos/files, which live outside Postgres (lib/storage.ts)
 * and would otherwise be orphaned forever. Irreversible; callers must confirm
 * with the owner before calling this.
 */
export async function deleteOrganization(orgId: string): Promise<void> {
  const paths = await query<{ file_path: string }>(
    `SELECT pp.file_path FROM project_photos pp JOIN projects j ON j.id = pp.project_id WHERE j.org_id = $1
     UNION ALL
     SELECT pf.file_path FROM project_files pf JOIN projects j ON j.id = pf.project_id WHERE j.org_id = $1`,
    [orgId],
  );
  await query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  await Promise.all(paths.map((p) => deleteUpload(p.file_path)));
}
