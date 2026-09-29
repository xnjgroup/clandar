# Clandar

A multi-tenant business dashboard for a home-improvement company: customers, jobs, AI-assisted
photo quoting, scheduling, a task/shopping/permit list, and a Gmail-backed customer-support inbox
— plus the invoice extraction, approvals, budgets and spend-analytics module the app started as.
Every page reads from a local Postgres database — there is no fixture data in the app code.

## Getting started

### 1. Postgres

The app expects a local Postgres. If you are already running the `clandar-postgres`
container, it is ready to use:

```bash
docker run -d --name clandar-postgres -p 5432:5432 \
  -e POSTGRES_USER=clandar -e POSTGRES_PASSWORD=clandar_dev -e POSTGRES_DB=clandar \
  pgvector/pgvector:pg17
```

### 2. Redis

Backs the Gmail cleanup job queue (BullMQ). Optional — everything except
inbox analysis works without it.

```bash
docker run -d --name clandar-redis -p 6379:6379 --restart unless-stopped redis:7-alpine
```

### 3. Environment

```bash
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # APP_ENCRYPTION_KEY
```

| Variable | Used for |
| --- | --- |
| `DATABASE_URL` | Connection string; the database it names is created by `db:setup`. |
| `REDIS_URL` | BullMQ's connection. Defaults to `redis://localhost:6379`. |
| `APP_ENCRYPTION_KEY` | AES-256-GCM key for connector secrets. Rotating it makes stored secrets unreadable. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client for the Gmail and Calendar connectors. Leave empty to keep them greyed out. |
| `GOOGLE_REDIRECT_URI` | Optional. Leave unset — the redirect URI is derived per-request from whichever address you're connecting from (see below), which is what lets the same app be reached from `localhost` and, say, a phone over Tailscale without reconfiguring anything. Set this only to pin one fixed URL for a production deployment behind a stable domain. |
| `SESSION_SECRET` | Signs the sign-in session cookie. Falls back to `APP_ENCRYPTION_KEY` if unset. Rotating it signs everyone out. |

### 4. Schema and data

```bash
npm run db:setup   # creates the database if missing, applies db/schema.sql (idempotent)
npm run db:seed    # replaces the expense data, keeps connectors
npm run db:reset   # both
```

`npm run db:seed -- --all` also clears connectors and pending OAuth state.

The seed writes a coherent starting set: 6 people, 17 vendors, 118 locations, 3,000
assets, two years of invoices with line items, budgets, alert rules, fraud flags and
one agent transcript. Current-month amounts are chosen so the dashboard has something
to say — utilities near its cap, dining over it, and a duplicated telecom invoice that
trips the fraud check.

### 5. Run it

```bash
npm run dev
```

## Authentication

The app is multi-tenant and requires signing in with Google — there is no username/password.
Every table below the `organizations` one is scoped to an org; a signed-in person only ever
sees their own org's data. See `lib/auth.ts`.

- **First sign-in ever** (on a fresh database) claims the bootstrap org that already-configured
  connectors/LLM providers were migrated onto, as its owner — so setting those up before anyone
  has signed in isn't lost.
- **Signing in with an invited email** joins the org that invited it, with the invited role
  (`/settings`'s Team section sends invites — an owner enters an email + role there; no email is
  actually sent yet, so tell the person directly to sign in with that Google account).
- **Any other new sign-in** creates a brand-new, isolated organization, as its owner.

This is a *second, separate* Google OAuth client usage from the Connectors section below: login
only ever requests `openid email profile` (who you are) and never stores a token — once the
profile is read, a plain server-side session (`sessions` table + a signed cookie) takes over.
Connectors request Gmail/Calendar *data access* scopes and store long-lived tokens instead. Both
reuse the same `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, but **need their own entries** under
*Authorized redirect URIs* on the OAuth client, since the callback paths differ:

- `{origin}/api/connectors/google/callback` — connectors
- `{origin}/api/auth/google/callback` — sign-in

...for every `{origin}` you actually use (`http://localhost:3000`, a Tailscale address, etc.) —
same requirement as the connectors flow, just a second path per address.

## Jobs, customers, scheduling, quoting & tasks

The core of the app: a `customers` table and a `jobs` table (one property, one project, a status
from `lead` through `completed`/`cancelled`) that everything else hangs off, all scoped to the
signed-in org.

- **Customers** (`/customers`, `lib/customers.ts`) — contact info and every job for that customer.
- **Jobs** (`/jobs`, `lib/jobs.ts`) — the hub page (`/jobs/[id]`) holds a job's status, crew
  assignment, photos, estimates, schedule, tasks and files all in one place.
- **Quoting** (`lib/quoting.ts`, `lib/job-photos.ts`) — upload photos of the job site, then "Analyze
  photos with AI" sends them (as `image_url` parts, so the org's default LLM provider needs vision
  support — every current OpenAI chat model and most local multimodal ones qualify) to propose a
  line-itemized estimate. Nothing is ever saved or sent automatically: the proposal is editable,
  saving it creates a `draft` row in `estimates`/`estimate_line_items`, and a separate "Send"
  action emails it (`sendMail` in `lib/gmail.ts`, plain text, via a connected Gmail account) only
  when someone clicks it.
- **Scheduling** (`/schedule`, `lib/schedule.ts`) — `schedule_entries` ties a job to a crew member
  and a time window; the standalone page lists the next 30 days and can filter to one person (a
  simple stand-in for a per-person "route"). The same form appears on a job's own hub page.
- **Tasks** (`/tasks`, `lib/tasks.ts`) — one table, three kinds (`todo`, `shopping`, `permit`),
  optionally tied to a job; `app/(dashboard)/tasks/{task-list,add-task-form}.tsx` are shared
  between the standalone page and a job's hub page.
- **Project records** — a job's hub page *is* the record: photos and files
  (`job_photos`/`job_files`, bytes on local disk under `UPLOADS_DIR`, streamed back through
  `/api/jobs/[jobId]/{photos,files}/[id]`, gated by the job's own org check) alongside its
  estimates and an optional link from `invoices.job_id` for spend already tied to that job.
- **Customer support** — the existing Email section below already covers reading, summarizing and
  cleaning up a connected inbox; `sendMail` (built for quoting) is the same primitive a reply or a
  schedule-confirmation email would use.

## How the data flows

- `db/schema.sql` — every table, safe to re-run. `db/seed.mts` — the starting data.
- `lib/db.ts` — the `pg` pool (one per process, reused across dev reloads).
- `lib/queries.ts` — every read the pages make. Pages call these, never `pg` directly.
- `lib/data.ts` — design and navigation config only: tones, category tiles, formatters.
- Filters, tabs and pagination live in the URL (`?status=`, `?q=`, `?page=`), so pages
  stay Server Components. The root layout is `force-dynamic`; nothing is prerendered.

## Connectors

`/connectors` manages the systems the dashboard talks to.

**Any HTTP MCP server.** Give it a name, URL and optionally a bearer token, API-key
header, or basic auth. Saving runs the MCP handshake right away (`initialize`, then
`tools/list`, over streamable HTTP, JSON or SSE replies) and records the server name,
its tools, and any failure against the row. **Test** re-runs it.

**Gmail and Google Calendar.** Gmail connects with `gmail.modify` (read plus trash and
labels — explicitly *not* permanent delete, which needs the much broader
`https://mail.google.com/` scope this app doesn't request); Calendar is read-only
(`calendar.readonly`). A connector made before `gmail.modify` existed only has the old
`gmail.readonly` grant until it reconnects — `hasGmailModifyScope` gates the trash
actions on that, and the connectors list and cleanup screen both prompt to reconnect
when it's missing. Creating the OAuth client is not enough either way — enable the
**Gmail API** and **Google Calendar API** in the same project's API library, or the
first call comes back `403 accessNotConfigured` even though consent succeeded.
Connect sends you to Google's consent screen; the callback at
`/api/connectors/google/callback` exchanges the code server-side, stores the tokens
encrypted, refreshes them when they expire, and proves the connection by calling the
Gmail profile or calendar-list endpoint.

The redirect URI sent to Google is built from the request that clicked Connect
(`lib/request-origin.ts`), not a fixed value — so it's correct whether you're on
`localhost` or opening the app over Tailscale from a phone, with no config change
between them. Google still requires an exact match against a pre-registered allowlist,
so **every address you actually connect from must be added** under *Authorized redirect
URIs* on the OAuth client in the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials) — `/connectors`
shows the exact URI the current request would use.

Secrets and tokens are encrypted with AES-256-GCM (`lib/crypto.ts`) before they reach
Postgres and are never sent to the browser — the connector list only knows *whether* a
secret exists.

## Settings

`/settings` configures LLM providers — any OpenAI-compatible chat endpoint: OpenAI
itself, or a local server like LM Studio or Ollama. Give it a name and base URL (its API
root including the version path, e.g. `http://<host>:1234/v1`); saving lists the
endpoint's models via `GET /models` and picks one for you — there's no model field to
fill in by hand. Exactly one provider can be the **default**, and independently, exactly
one can be the **email analyzer** the [cleanup worker](#inbox-cleanup) calls — a smaller
local model can run analysis while a different one stays default, or the same one can be
both. Both assignments enforce "at most one" as a partial unique index in Postgres
(`llm_providers_one_default`, `llm_providers_one_email_analyzer`), so switching is one
atomic `UPDATE`, never a moment with none or two set.

## Email

`/email` reads the connected Gmail account live — nothing is copied into Postgres.

- Views are Gmail searches (`Bills & receipts`, `Inbox`, `Unread`, `With attachments`,
  `All mail`), and the search box takes Gmail syntax (`from:acme has:attachment`).
  Paging follows Gmail's opaque page tokens, kept as a trail in the URL so Prev works.
- Opening a message shows its headers, body and attachments. Attachments stream through
  `/api/email/[id]/attachments/[attachmentId]`, so the browser never sees a Google token.
- A message body is untrusted HTML, so it renders inside an iframe with `sandbox=""` and
  its own `default-src 'none'` CSP: no scripts, no remote images, no tracking pixels.
  Inline `data:` images still show, and there is a plain-text toggle when the sender
  supplied both parts.
- More than one Gmail account can be connected; an account switcher appears once there's
  more than one, and each message/attachment URL carries `?account=` so the right one's
  token is used.
- The label dashboard (Inbox, Unread, Starred, Promotions, Social, Updates, Forums,
  Spam, Trash) calls `labels.get` per label in parallel — `labels.list` doesn't return
  counts. Clicking a tile searches that label; **Trash all spam** appears specifically
  when viewing Spam (see Inbox cleanup below for why it's trash, not permanent delete).

Payload parsing (base64url bodies, nested multiparts, `"Name" <addr>` headers) lives in
`lib/gmail-payload.ts` as pure functions, separate from the API calls in `lib/gmail.ts`.

## Inbox cleanup

`/email/cleanup` finds old, low-value mail and lets you review it before anything is
touched — nothing is ever deleted automatically.

**Analyze inbox** enqueues a scan on a BullMQ queue backed by Redis; the worker that
runs it (`lib/gmail-cleanup-worker.ts`) starts once from `instrumentation.ts` at server
boot, in the same process as the app — not a separate script — specifically so it can
use the same `@/lib/...` imports as everything else (a standalone script run with plain
`node` can't resolve that alias; only Next's own bundler does). **This means editing
worker code needs a server restart to take effect** — `instrumentation.ts`'s `register()`
runs once per process, and the `Worker`'s processor callback keeps whatever closure it
captured at that point, unlike route/page code which hot-reloads normally.

A scan can be scoped to the whole inbox or one label (Promotions, Social, Updates,
Forums) — `lib/cleanup-heuristics.ts`'s pure rules narrow it down first (age floor,
promotional category, automated-looking sender, an "unsubscribe" mention — unread,
starred, and important mail is never a candidate, full stop), then the provider assigned
on `/settings` as the **email analyzer** reviews each candidate in a batch, writes a
plainer reason, and can veto a false positive outright. No analyzer configured just means
heuristics-only results — the scan still runs.

Every result is a row in `cleanup_candidates`, reviewed on the same page: check the ones
you agree with, then **Dismiss** (hides it) or **Move to Trash** (calls Gmail's
reversible `messages.trash` — 30-day recovery in Gmail, never a permanent delete).
**Trash all spam** on `/email` is the same trash call applied directly to everything
already in Spam, no review step, since spam is presumptively junk already.

Gmail's per-minute quota is real and scanning hundreds of messages can hit it —
`lib/gmail.ts`'s `call()` retries a 429 (or a 403 that says the same thing) with
exponential backoff before giving up, and the scan's own concurrency is intentionally
lower than the interactive mailbox view for the same reason.
