# Clandar — Roadmap

What's shipped, what's in progress and what's next. `doc/DESIGN.md` has the architecture; the
native iOS app lives in its own repo (`clandar-ios`).

_Last updated: 2026-10-02._

## Shipped

### Jobs core (web + iOS)

- Customers; projects (lead → quoted → scheduled → in progress → completed / cancelled) with
  per-org project types and icons; the Projects list opens on **Open** (everything not completed
  or cancelled).
- AI photo quoting with editable draft estimates, sent to customers on the org's letterhead; an
  accepted estimate becomes the project's work tasks and materials list.
- Scheduling with Timeline / List / Map views (geocoded places, OpenStreetMap tiles), entries with
  or without a project, assigned to anyone on the crew, shown in the viewer's time zone.
- Tasks of three kinds — to-do checklists, shopping lists (quantities, prices, links), reminders
  (time, repeat, push + email when due).
- Project pages: photos (full-screen viewer), files in folders with tags, invoices & receipts,
  estimates, schedule (Timeline / List / Map), and a **Discussion** — threaded comments with
  @-mentions, #-references to the project's things, link and video previews.

### The Clandar assistant

- Chat with native tool calling and token streaming (SSE), Markdown replies, image and document
  attachments, many conversations, a stop button, sounds and an unread indicator.
- Reads and writes real data: projects, customers, schedule, tasks, invoices, email (search,
  confirmed bulk trash), project discussions (posts after the user confirms), maps (find a place,
  route), Apple Calendar on the iPhone (read; add / delete after confirming on the phone).
- Ready-made in-app links in replies (relative, opened inside the app on iOS).
- **Connected systems**: tools from the org's MCP servers, live, with a per-server **Configure
  tools** dialog to choose which ones the assistant may use, and **Refresh tools**.
- **Document search** (`search_library`): answers from the full text of every project file —
  English and Chinese — citing the document and page.
- Automations (scheduled AI tasks) whose reports arrive in the chat; the lead finder that spots
  project requests in Gmail, with a review queue and daily digest.
- Notifications (in-app, Web Push, APNs) living in the assistant's Updates.
- The assistant's name is per org (default "Clandar").

### Email

- A full Gmail view: views, labels, search, attachments, several accounts, sandboxed rendering,
  view an invoice's original email.
- Inbox cleanup (heuristics + AI review) and bulk trash as a background job with pause / resume /
  cancel.

### Finance (the app's original core)

- Invoice and receipt extraction (upload or email), expenses by vendor / category / month,
  recurring charges, budgets, approvals, fraud flags; vendors, assets and locations.
- Invoices link to projects (a project's spent vs. quoted).

### Platform

- Multi-tenant orgs with owner / crew roles and invites; sign in with Google, Apple, or an emailed
  link / code; onboarding with a company type that seeds project types.
- Per-org AI providers (any OpenAI-compatible endpoint) with a provider + model per feature (chat,
  email, invoices, quotes) and a platform-wide built-in fallback.
- Connectors: Gmail and Google Calendar (many accounts), MCP servers over HTTP with token, API-key,
  basic or **OAuth sign-in** (discovered automatically from a 401), server URLs kept exactly as
  typed.
- **Sample data** for new workspaces — a renovation contractor (crew, five jobs with estimates,
  photos, contract / permit PDFs, discussion, tasks, supplier invoices, budgets) and a travel plan —
  added from an empty Overview and removed in one go without touching the person's own records.
- A customizable Overview dashboard (movable, resizable widgets).
- Resilience: losing Redis only pauses background jobs; the site stays up.
- Landing page = sign-in, Google Analytics, page titles, new logo and favicons.

### Native iOS app (SwiftUI, iOS 26)

- Sign in (Apple, Google, email); first-launch walkthrough.
- Today (assistant card first, schedule incl. Apple Calendar events, due tasks), Projects,
  Scheduled (Timeline / List / Map), Tasks, the Clandar chat (links open in the app, conversation
  search, Apple Calendar add / delete confirmation cards).
- A side-drawer menu whose screens slide up full screen: Customers, Email (full screen, day
  groups, search screen with filter chips, Filters sheet, In Folder picker), Automations,
  Directory, Invoices, Expenses, Settings.
- Settings → **Connectors** (Apple Calendar on the phone; connect Gmail / Google Calendar and add
  MCP servers with sign-in in the secure sheet; test, reconnect, on/off, per-tool switches) and
  **AI providers** (which provider and model each feature uses; add / test / remove providers).
- Push notifications (APNs), sample data offer and Remove strip.

## In progress

### Library — everything filed, searchable by the assistant

One place for every project's files, documents uploaded to the Library itself, and saved web
articles, with search the chat can use.

- [x] PGroonga full-text index (Chinese + English) over passages of each document, with PDF pages,
      highlighted snippets and ranking (`lib/library.ts`).
- [x] Every project file is mirrored into the Library and indexed after upload; existing files are
      indexed on first use.
- [x] The `search_library` chat tool.
- [x] Library page on the web (Work → Library): full-text search with highlighted passages and PDF
      pages, Everything / Project files / My documents, a project filter, upload with tags, open,
      delete.
- [ ] The Library's own folders.
- [x] Library in the iOS app (menu → Library): the same search and filters, open in Quick Look,
      add from Files, swipe to delete.
- [x] Save web articles — from a link in the chat (`save_article`), the web Library's "Save an
      article", or the app's + → Save a link: a readable copy (Mozilla Readability; WeChat 公众号
      articles read directly), an AI summary with key points and tags, indexed for search; an article
      page on the web and in the app showing the formatted article with its pictures — saved copies
      (up to 40, shrunk to ≤1600 px WebP), cleaned with sanitize-html. Server-side fetches refuse
      private / internal addresses.
- [ ] Meaning (vector) search beside full text: pgvector + a separate embeddings service
      (`text-embedding-3-small` via OpenAI in production), merged by reciprocal rank fusion.
- [ ] Scanned PDFs and photos of documents read by the AI provider's vision model.
- [ ] iPhone share sheet: "Save to Clandar".

## Next

- **MCP endpoint for other AI agents** — serve Clandar itself as a remote MCP server at `/mcp`
  exposing the same tools the chat uses (projects, schedule, tasks, invoices, email, library …),
  with OAuth sign-in (`/oauth/register|authorize|token|revoke`) so Claude and other agents can
  connect as the user, scoped to their org and role.
- **Background jobs without the Upstash quota problem** — the BullMQ workers poll Redis from every
  Vercel instance and used up the free tier (Gmail bulk trash, automations and reminders are paused
  until this is decided): cron + Postgres for scheduled work, one always-on worker host, or a paid
  Upstash plan.
- **Google app verification** for the Gmail scope, so connecting Gmail no longer shows "Google
  hasn't verified this app" (restricted scope → security assessment).
- **Branded transactional emails** — one shared HTML wrapper (`lib/email-template.ts`) for invites,
  reminders and the lead digest, plus a welcome email and an "invite accepted" notice.
- Smaller items: hide the iPhone-only calendar links in the web chat; fail fast when the AI
  provider doesn't respond; task links that open the task itself; "+" buttons on the other project
  sections in the iOS app.
