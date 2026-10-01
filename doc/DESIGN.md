# Clandar — Design Doc

Clandar is a multi-tenant web app for running a small service business (home improvement is the
reference customer): customers, projects, AI-assisted photo quoting, scheduling with places and
routes, tasks and reminders, an AI assistant that acts on the org's data, a Gmail-backed inbox
with a lead finder and bulk cleanup, recurring AI automations — plus the invoice-extraction /
approvals / budgets / spend-analytics module the app originally started as. Every page reads live
from Postgres; there is no fixture or mock data anywhere in the app code.

This doc is the architectural map. `README.md` is the day-to-day operator/developer guide (env
vars, local setup, per-feature detail) — read that for "how do I run this" and this doc for "how
is this put together and why." The last section, **Native iOS client**, is the starting point for
building a native app against the same backend.

## Stack

- **Next.js 16** (App Router, React 19, Turbopack), TypeScript, Tailwind v4 (theme tokens in
  `app/globals.css`: ink, lime, line, ok/warn/bad …). The dashboard layout is `force-dynamic` —
  nothing is prerendered, every page is org-scoped live data. Deployed on **Vercel**
  (clandar.com); `main` deploys on push.
- **Postgres** (Supabase in production, via its transaction pooler on port 6543; `pg` driver, one
  small pool per process — `lib/db.ts`) is the only datastore for app records.
- **Redis + BullMQ** back two background queues (Gmail jobs, scheduled work — see Background
  workers). Everything except those features works without Redis; code that touches the queue
  from a request path checks `REDIS_URL` first, because an unreachable Redis otherwise blocks
  forever (`maxRetriesPerRequest: null`, as BullMQ requires).
- **Cloudflare R2** (S3-compatible) or local disk (`UPLOADS_DIR`) for project photos/files and
  chat attachments (`lib/storage.ts`).
- Any **OpenAI-compatible LLM endpoint** (OpenAI, LiteLLM, LM Studio, Ollama …), configured per
  org with per-feature assignments, and an admin-level platform provider ("Built-in") as the
  fallback (`lib/llm-providers.ts`).
- **Google OAuth**, twice, for unrelated purposes: user sign-in, and the Gmail/Calendar connector.
- **Web Push** (VAPID, `lib/push.ts`) for notifications to browsers/phones.
- **OpenStreetMap services** (free, keyless): Nominatim for geocoding, OSRM for driving routes,
  OSM tiles in Leaflet for maps (`lib/geocode.ts`).
- Well-known packages over hand-rolled parsing: `react-markdown` (+ GFM) for chat, `html-to-text`
  and `postal-mime` for email bodies/.eml, `eventsource-parser` for SSE, `react-grid-layout` for
  the dashboard, `leaflet`/`react-leaflet` for maps, `apexcharts` for charts, `pdf-parse` etc. for
  document text (`lib/document-extract.ts`).

## Multi-tenancy & auth

Every table below `organizations` carries an `org_id`; a signed-in person only ever sees their own
org's rows (`lib/auth.ts` — `requireSession()` returns `{ person, org }`, and every query filters
by `org.id`). There's no username/password — sign-in is Google OAuth only (`openid email profile`,
no data scopes, no stored token). A server-side `sessions` row plus a signed, httpOnly cookie
(`clandar_session`) takes over after that.

Sign-in resolves to exactly one of three outcomes:

1. **First person ever** on a fresh database claims the bootstrap org, as owner.
2. **An invited email** (`org_invites`, created from `/settings` → Team by an owner) joins that
   org with the invited role.
3. **Any other new email** creates a brand-new, isolated org, as its owner, and is sent through
   `/onboarding` to name it and pick a company type (which seeds its project types).

A person belongs to one org. **Roles**: `owner` (settings such as the workspace name, the
assistant's name, providers, team) and members. `/admin` is a second, orthogonal privilege:
cross-tenant, gated by `ADMIN_EMAILS`, granting only platform views (the Built-in LLM provider,
read-only org list) — nothing inside any org's data.

The team concept is a **user group** in naming (types, tables, routes), never "team"; and
user-facing URLs, files and components avoid an "admin" prefix except the real `/admin` area.

## Navigation / feature map

The sidebar (`components/app-shell.tsx`, config in `lib/data.ts`) is the map of the product:

```
Overview   Projects   Customers   Scheduled   Tasks   Email      ← NAV_TOP
Finance  → Invoices, Expenses, Recurring, Budgets, Approvals, Fraud
Directory→ Vendors, Assets, Locations
Connectors  Settings                                              ← NAV_FOOTER
(Admin — only if the signed-in email is in ADMIN_EMAILS)
```

On phones the sidebar becomes a hamburger menu plus a floating bottom tab bar
(`MOBILE_TABS`: Overview, Projects, Scheduled, Tasks, and the assistant as the fifth tab).

### Overview

A dashboard of widgets the person can rearrange and resize (`components/dashboard-grid.tsx`,
react-grid-layout; layout saved per person in `dashboard_layouts`; widgets stack in layout order
below 900px). Widgets: project stats, active projects, the assistant card (quick Ask/Do prompts),
spending stats, spend by category, needs attention, recent invoices. Grid cells never scroll — a
widget fills its cell and only its list scrolls.

### Jobs / field-service core

- **Customers** (`/customers`, `lib/customers.ts`) — contacts and their projects. New customer is
  a modal from the page header's "+".
- **Projects** (`/projects`, `lib/projects.ts`) — one property + one job of work, status `lead` →
  `quoted` → `scheduled` → `in_progress` → `completed`/`cancelled`. The hub page
  (`/projects/[id]`) is the record: status, crew, photos & quoting, schedule, tasks, files
  (folders, tags, doc types), invoices & receipts linked to it. Project *types* are a per-org list
  (`project_types`, seeded from the company type at onboarding). New project is a modal from the
  header "+"; project types behind the header's gear.
- **Quoting** (`lib/quoting.ts`, `lib/project-photos.ts`) — site photos → "Analyze photos with AI"
  (the org's quote LLM, needs vision) proposes a line-itemized estimate. Nothing is saved or sent
  automatically: saving writes a `draft` (`estimates`/`estimate_line_items`), a separate explicit
  Send emails it through Gmail with the org's letterhead.
- **Scheduled** (`/schedule`, `lib/schedule.ts`) — `schedule_entries`: *what's happening*
  (`notes`), date and time window, who (optional), **project (optional** — trips and appointments
  are first-class), and **where** (`location` + `lat`/`lng`). Views everywhere schedules appear
  (the Scheduled page and each project): **Timeline** (default, a vertical day-by-day rail),
  **List**, and **Map** (numbered stops per day, OSRM driving route with miles/minutes, dashed
  straight lines for legs over ~155 mi, Directions → Google Maps). The chosen view is remembered
  per device. Places are geocoded on save; entries missing coordinates (or falling back to the
  project's address) are filled in after the page renders (`after()` → `locateScheduleEntries`).
  Times are stored as UTC instants and always entered/shown in the viewer's zone (the browser
  sends its IANA zone; lists render client-side).
- **Tasks** (`/tasks`, `lib/tasks.ts`) — one table, three kinds: `todo`, `shopping` (with
  check-off items, `task_items`), `reminder` (due date + time in its own zone, repeats
  daily/weekly/monthly/yearly). Optionally tied to a project and assigned. Reminders fire from the
  5-minute tick (`lib/reminders.ts`) as a notification, a push and optionally an email.
- **Automations** (`/tasks/scheduled`, `lib/scheduled-tasks.ts`) — recurring AI jobs (e.g. Daily
  briefing) on a daily / weekdays / weekly schedule in the creator's zone. A run builds a JSON
  snapshot of the org's real data (today's schedule, due tasks, stale leads/quotes …), asks the
  default LLM, records it in `scheduled_task_runs` — and **delivers it into the chat**: a new
  conversation ("Daily briefing · Wed, Oct 1") whose first message is the report, so the person
  can reply to it, plus a short notification with **Open in chat** and a push. Runs claim their
  slot atomically (`UPDATE … WHERE next_run_at <= now() RETURNING`) so two workers can't
  double-run, and runs left `running` by a restart are closed after 15 minutes.
- **Lead finder** (`lib/lead-finder.ts`, Email → Leads, settings under Automations) — watches
  connected Gmail on a cadence, has the email-analyzer LLM classify new mail against the org's
  project types, queues real work requests in `email_leads` (create project / follow up / not a
  lead), optionally labels them in Gmail, and sends a daily digest. Never creates a project or
  sends anything on its own.

### The assistant (Clandar itself)

The chat panel on every dashboard page (`components/assistant-widget.tsx`, server in
`lib/assistant.ts`, streamed by `app/api/assistant/route.ts`).

- **Name**: per workspace (`organizations.assistant_name`, default "Clandar" — the app is the assistant; owner can rename it in
  Settings → Chat — one word, letters/numbers, ≤ 10 chars). Used in the UI and its system prompt.
- **Model & tools**: the org's chat provider (Settings → Chat, or Built-in). **Native
  OpenAI-style tool calling** (`chatStreamWithTools`), with the reply streamed token by token.
  Tools (all org-scoped, acting on real data):
  customers/projects/project types (`list_*`, `create_*`), tasks (`list_tasks`, `create_task`),
  estimates (`draft_estimate_from_photos`, `create_estimate`), files (`attach_files_to_project`),
  invoices (`list_invoices`, `get_invoice`, `link_invoice_to_project`), schedule
  (`list_schedule`, `create_schedule_entry`, `update_schedule_entry`, `delete_schedule_entry`),
  maps (`find_place`, `get_route`), email search & cleanup (`search_email`,
  `trash_email_search`), and — only while viewing an email — `draft_email_reply`,
  `send_email_reply`, `attach_email_files_to_project`, `record_email_invoice`.
- **Safety rules** enforced in code, not just the prompt: sending email only on explicit
  instruction; `search_email` searches one mailbox the user chose (with several connected it
  refuses and returns the list); `trash_email_search` needs the mailbox, query and the count the
  user confirmed, recounts before starting and refuses if the count moved (> 5 or 5%); everything
  "deleted" goes to Gmail's 30-day Trash.
- **Protocol**: `POST /api/assistant` → Server-Sent Events: `started {conversationId}`,
  `tool_call {tool, detail}`, `reply_delta {text}`, `done`, then `conversation` (the saved turns),
  or `error`. The browser's AbortController is **Stop**: `request.signal` reaches the model call
  and the tool loop; what was written is saved, marked "_Stopped._".
- **Conversations**: multiple, switchable, archivable (`agent_conversations`, `agent_messages`,
  `agent_tool_calls`, `agent_message_attachments`). Shared by the whole org: each user message
  records its sender (`agent_messages.person_id`), the model sees messages as `[Name] …`, and the
  UI labels other people's messages. Attachments: images go to the model as-is; PDF/Word/Excel/
  PowerPoint/markdown are text-extracted server-side. Knows the page being viewed and, on an
  email, the email and its attachments. Every turn is traced (`agent_traces`; `npm run trace`).
- **Updates** (the bell in the chat header): notifications rendered as messages from the
  assistant, running background jobs as live progress cards (pause/resume, cancel), dismiss /
  clear all, the push switch and a "Sound on this device" switch.
- **Attention**: unread count badges the assistant's button (desktop) / tab (phone); a new
  notification rings the icon, pops the badge and plays a chime; closing the chat mid-reply shows
  a typing bubble on the icon, then a bounce + lime dot and a softer sound when the reply lands
  (also played when the chat is open but the tab isn't focused). Sounds are synthesized with Web
  Audio (`components/notification-sound.ts`); all motion respects `prefers-reduced-motion`.

### Email

- **`/email`** — reads connected Gmail accounts live (nothing copied into Postgres); views are
  Gmail searches (Inbox, Bills, Unread, Attachments, All), system/user labels with unread counts,
  and a raw Gmail-syntax search. Bodies render in a sandboxed, scriptless iframe; attachments
  stream server-side through `/api/email/[id]/attachments/[partId]` (looked up by part id — Gmail
  attachment ids aren't stable). Multiple accounts with a switcher. The From/To row expands on
  tap. From an email, the assistant can summarize, draft/send replies, set a follow-up, confirm a
  schedule, attach files to a project, or record an emailed invoice (deduplicated).
- **Bulk trash** — "Trash all spam/promotions" and the assistant's confirmed search trash run as
  BullMQ jobs (`trash-label`, `trash-search`). Progress, **pause/resume and cancel** live in the
  assistant's Updates (a Redis flag the worker checks before each message); the person who
  started it gets a notification (and push) when it finishes, stops or fails. Search trashes
  re-list from the top after each batch so trashed mail can't make a page token skip messages.
  One run is capped at 2,000.
- **`/email/cleanup`** — finds old, low-value mail for review with pure heuristics plus the email
  analyzer LLM's veto; nothing is auto-deleted.
- Only `gmail.modify` is requested (read, labels, trash) — never the permanent-delete scope.

### Finance module (the app's original core)

- **Invoices** (`/invoices`) — extracted invoices with line items, flags and source documents
  (`invoice_documents`, PDFs/images, parsed with the invoice LLM); linkable to a project (its
  spend then shows on the project). Emailed invoices can be recorded by the assistant.
- **Expenses**, **Recurring**, **Budgets**, **Approvals**, **Fraud** — spend analytics, recurring
  charges, category caps, the approval queue and fraud flags over the same invoice data
  (`lib/queries.ts`).

### Directory

- **Vendors** (spend rollups), **Assets** (phone lines, meters, licenses, hardware), **Locations**.

### Platform / integration

- **Connectors** (`/connectors`, `lib/connectors.ts`) — HTTP MCP servers (handshake + tool list
  on save), and Gmail (`gmail.modify`) / Google Calendar (`calendar.readonly`) via OAuth. Tokens
  are AES-256-GCM encrypted (`lib/crypto.ts`) and never sent to the browser.
- **Settings** (`/settings`) — workspace name; LLM providers (any OpenAI-compatible endpoint,
  models auto-listed) with per-feature assignment: **Chat**, **Email** (analyzer), **Invoices &
  receipts**, **Quotes** — each can be "Built-in" (the platform provider); the assistant's name;
  team invites and roles; delete company.
- **Notifications** (`lib/notifications.ts`, `notifications`) — per-person rows (title, markdown
  body, link, read, dismiss). Sources: reminders, lead digests, finished/failed bulk trashes,
  automation results. Delivered in the assistant's Updates and as Web Push
  (`push_subscriptions`, one per device). A link of the form `/overview?chat=<conversationId>`
  opens that conversation in the assistant.
- **Header actions** — a page puts its main action (the "+" for new customer/project/task/
  schedule entry, Automations, Project types) into the header's top-right slot via
  `<HeaderActions>` (a portal).

## UI conventions

- Adding and editing happen in **modals** (native `<dialog>`; `components/modal-dialog.tsx`), with
  stacked, labelled, fixed-height (42px) fields and a full-width primary button.
- Phones: compact, one-row sideways-scrolling filter chips, multi-line list rows instead of
  truncation, 16px form text on touch screens (stops iOS Safari's focus zoom), and a phone-only
  type ramp that steps every small text size up ~1px (`globals.css`).
- Filters, tabs and pagination live in the URL (`?status=`, `?q=`, `?view=`) so pages stay Server
  Components; per-device preferences (schedule view, sound) live in `localStorage` with a
  fallback when storage is blocked.

## Data flow conventions

- `db/schema.sql` — every table, safe to re-run (`IF NOT EXISTS`, additive `ALTER … ADD COLUMN IF
  NOT EXISTS`); `npm run db:setup` applies it. No seed data. (Defaults on existing columns need an
  explicit `ALTER COLUMN … SET DEFAULT`.)
- `lib/db.ts` — the single `pg` pool. `lib/queries.ts` — shared reads; each feature's reads and
  writes live in `lib/<feature>.ts` and its route's `actions.ts` (Server Actions).
- `lib/data.ts` — presentation/navigation config only (safe for client components).
- Time: instants are UTC in Postgres; wall-clock inputs come with the browser's IANA zone
  (`TimeZoneField`, `lib/time-zone.ts`), and anything with a recurring local time (reminders,
  automations) stores its zone.

## Background workers

Started once in-process at server boot (`instrumentation.ts`, Node runtime), so processors share
the app's `@/lib/...` imports. **Editing worker code needs a server restart** — the processor
closure is captured at boot.

1. **Gmail** (`lib/gmail-cleanup-worker.ts`) — inbox-cleanup scans and bulk trashes
   (`trash-label`, `trash-search`) with `{ done, total, paused }` progress, a pause/cancel flag in
   Redis, and a completion notification.
2. **Scheduled work** (`lib/scheduled-tasks-worker.ts`) — a 5-minute tick that fires due
   reminders, runs the lead finder and digests, and enqueues due automations.

`/api/cron/reminders` (Bearer `CRON_SECRET`) is the same tick for serverless hosting. Job progress
streams to the browser over SSE (`GET /api/gmail-jobs/[jobId]`, own-org jobs only).

## Security notes

- Org scoping on every query; object-level checks on every file, attachment and job route.
- Secrets and OAuth tokens encrypted at rest, never serialized to the client.
- Untrusted email HTML in a sandboxed iframe with a `default-src 'none'` CSP.
- Gmail: `gmail.modify` only; every delete is the reversible Trash.
- Destructive assistant actions need an explicit, code-checked confirmation (see the assistant).
- Assistant actions that reach other people (posting a project comment that notifies them) are previewed
  first and stored in `assistant_pending_actions`; `confirm: true` carries out exactly the stored preview,
  once, and only after the user has written a new message since it (`lib/assistant-discussion.ts`).
- `/admin` gated by an email allowlist, independent of org roles.

## Native iOS client

The iPhone app lives in its own repo (`clandar-ios`: SwiftUI, iOS 26, XcodeGen). It is a thin client
over the same server — every rule stays in `lib/*`, shared with the web.

**Auth.** `POST /api/v1/auth/{email/start, email/verify, google, apple}` verify the sign-in (email
code; Google ID token with aud `GOOGLE_IOS_CLIENT_ID`; Apple identity token with aud
`APPLE_BUNDLE_ID`) and return a 90-day session token (`signInForApp` in `lib/auth.ts`). The app sends
it as `Authorization: Bearer …`; `sessionTokenFromRequest()` accepts that or the cookie, so every
existing route works for both. `DELETE /api/v1/auth/session` signs out; `DELETE /api/v1/account`
deletes the account (owner: the whole company, confirmed by its name; others: leave, confirmed by
email) — App Store guideline 5.1.1(v).

**`/api/v1` (JSON, `lib/api.ts`).** `api()` wraps each handler (`ApiError` → `{ error }` + status;
`apiSession()` → 401, never a redirect). Route files export only handlers — shared helpers live in
`lib/api-*.ts`. Endpoints:
- `me`, `today`, `overview`, `lookups`
- `tasks`, `tasks/[id]`, `tasks/[id]/items`, `task-items/[id]`
- `projects`, `projects/[id]` (the hub, incl. its Discussion: `comments` + `refs`),
  `projects/[id]/quote` (AI proposal / save as estimate), `projects/[id]/comments` (post/reply),
  `comments/[id]` (edit/delete), `estimates/[id]`, `customers`, `customers/[id]`
- `schedule`, `schedule/[id]`
- `email`, `email/accounts`, `email/[id]`, `email/trash`, `email/leads`, `email/leads/[id]`
- `invoices`, `invoices/[id]` (GET by vendor slug + `?id=`; PATCH approve/reject/link project),
  `invoice-flags/[id]`, `finance` (stats, expenses, recurring, budgets, fraud, approvals),
  `directory` (vendors, assets, locations)
- `automations`, `automations/[id]`, `automations/[id]/run`, `lead-finder`, `lead-finder/scan`
- `settings` (names, people, invites), `settings/invites[/id]`, `settings/members/[id]`
- `devices` (APNs token register/unregister)

Reused unchanged: `/api/assistant` (SSE chat, conversations, attachments as data URLs — keep a
request under Vercel's 4.5 MB body cap), `/api/assistant/attachments/[id]`, `/api/notifications`,
`/api/gmail-jobs/[jobId]`, project photo/file routes, email attachments.

**Push.** `pushToPerson` fans out to Web Push and APNs (`lib/apns.ts`, `apns2`, token-based `.p8`
key: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`). Device tokens live in `device_tokens`
(per environment: sandbox for Xcode builds, production for TestFlight/App Store); tokens APNs
reports dead are deleted. The notification's `link` rides in the payload and the app maps it to a
screen (`/projects/<id>`, `/customers/<id>`, `/invoices/<slug>?id=`, `/email`, `/schedule`,
`/tasks`, any `?chat=<conversation>`).

**Client conventions.** The device's IANA zone goes with every wall-clock write (`timeZone`);
MapKit replaces the web map; untrusted email HTML renders in a `WKWebView` with JavaScript off and a
`default-src 'none'` CSP; AI providers and connectors (browser OAuth) open on the website.

## Where to look next

| Question | Start here |
| --- | --- |
| How does a request get its org/user? | `lib/auth.ts` |
| What does page X actually query? | `lib/queries.ts`, then that route's `lib/<feature>.ts` |
| How does the assistant call tools / stream? | `lib/assistant.ts`, `app/api/assistant/route.ts` |
| How is an LLM endpoint resolved for an org / feature? | `lib/llm-providers.ts` |
| Notifications, push, sounds | `lib/notifications.ts`, `lib/push.ts`, `components/use-notifications.ts` |
| Background jobs and their progress | `lib/queue.ts`, `lib/gmail-cleanup-worker.ts`, `lib/scheduled-tasks-worker.ts` |
| Places, maps, routes | `lib/geocode.ts`, `app/(dashboard)/schedule/schedule-map*.tsx` |
| Full table list and columns | `db/schema.sql` |
| Local setup, env vars, per-feature detail | `README.md` |
