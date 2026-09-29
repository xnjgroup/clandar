-- Clandar Expense — schema for the local Postgres database (clandar_expense).
--
-- Applied by `npm run db:setup`, which is idempotent: every object is created
-- only when missing, so it is safe to re-run after adding to this file.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

/* ── People ───────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS people (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'approver', 'member')),
  is_current  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Exactly one person is "signed in" while there is no auth layer.
CREATE UNIQUE INDEX IF NOT EXISTS people_one_current
  ON people ((is_current)) WHERE is_current;

/* ── Reference data ───────────────────────────────────────── */

-- Spend categories. Their icon and colours are design tokens and stay in
-- lib/categories.ts; a category with no entry there falls back to a neutral
-- tile, so adding one here needs no code change.
CREATE TABLE IF NOT EXISTS categories (
  name       text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  region     text NOT NULL,
  address    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS locations_region_idx ON locations (region, name);

CREATE TABLE IF NOT EXISTS vendors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  slug           text NOT NULL UNIQUE,
  category       text NOT NULL REFERENCES categories (name),
  account_number text,
  customer_since date,
  created_at     timestamptz NOT NULL DEFAULT now()
);

/* ── Assets ───────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('phone', 'meter', 'license', 'hardware')),
  label        text NOT NULL,
  identifier   text NOT NULL UNIQUE,
  vendor_id    uuid NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  location_id  uuid REFERENCES locations (id) ON DELETE SET NULL,
  monthly_cost numeric(12, 2) NOT NULL DEFAULT 0,
  is_idle      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assets_kind_idx     ON assets (kind, label);
CREATE INDEX IF NOT EXISTS assets_vendor_idx   ON assets (vendor_id);
CREATE INDEX IF NOT EXISTS assets_location_idx ON assets (location_id);
CREATE INDEX IF NOT EXISTS assets_search_idx   ON assets (lower(label), lower(identifier));

/* ── Invoices ─────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      uuid NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  category       text NOT NULL REFERENCES categories (name),
  location_id    uuid REFERENCES locations (id) ON DELETE SET NULL,
  invoice_date   date NOT NULL,
  amount         numeric(12, 2) NOT NULL,
  status         text NOT NULL DEFAULT 'extracted'
                   CHECK (status IN ('extracted', 'pending_review', 'flagged', 'approved', 'rejected')),
  page_count     integer NOT NULL DEFAULT 1,
  ocr_confidence numeric(4, 3),
  account_number text,
  period_start   date,
  period_end     date,
  due_date       date,
  payment_method text,
  prior_balance  numeric(12, 2) NOT NULL DEFAULT 0,
  submitted_by   text NOT NULL DEFAULT 'Ingested via upload',
  approver_id    uuid REFERENCES people (id) ON DELETE SET NULL,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_date_idx     ON invoices (invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoices_status_idx   ON invoices (status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoices_vendor_idx   ON invoices (vendor_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoices_category_idx ON invoices (category, invoice_date DESC);

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Line items are grouped on the document by the asset they belong to; the
-- group label is kept alongside the asset link so an unmatched group (taxes,
-- credits) still renders.
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  asset_id         uuid REFERENCES assets (id) ON DELETE SET NULL,
  group_label      text NOT NULL,
  group_identifier text,
  group_icon       text NOT NULL DEFAULT 'doc',
  tag              text NOT NULL CHECK (tag IN ('recurring', 'one-time', 'tax', 'credit')),
  description      text NOT NULL,
  amount           numeric(12, 2) NOT NULL,
  sort_order       integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx
  ON invoice_line_items (invoice_id, sort_order);

CREATE TABLE IF NOT EXISTS invoice_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  label       text NOT NULL,
  cleared_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_flags_invoice_idx ON invoice_flags (invoice_id);

/* ── Recurring charges ────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS recurring_charges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  uuid NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  category   text NOT NULL REFERENCES categories (name),
  amount     numeric(12, 2) NOT NULL,
  cadence    text NOT NULL DEFAULT 'month' CHECK (cadence IN ('month', 'quarter', 'year')),
  next_due   date NOT NULL,
  is_rising  boolean NOT NULL DEFAULT false,
  icon       text NOT NULL DEFAULT 'refresh',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, category)
);

/* ── Budgets & alerts ─────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS budgets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL UNIQUE,
  category    text REFERENCES categories (name),
  monthly_cap numeric(12, 2) NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label           text NOT NULL UNIQUE,
  threshold_kind  text NOT NULL CHECK (threshold_kind IN ('percent_of_cap', 'absolute_amount')),
  threshold_value numeric(12, 2) NOT NULL,
  channels        text[] NOT NULL DEFAULT '{}',
  is_paused       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_rule_id uuid REFERENCES alert_rules (id) ON DELETE SET NULL,
  message      text NOT NULL,
  icon         text NOT NULL DEFAULT 'bellSm',
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_events_time_idx ON alert_events (occurred_at DESC);

/* ── Fraud & anomalies ────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS fraud_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid REFERENCES invoices (id) ON DELETE SET NULL,
  title       text NOT NULL,
  note        text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('high', 'med', 'low')),
  exposure    numeric(12, 2) NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'dismissed', 'confirmed')),
  opened_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS fraud_flags_status_idx ON fraud_flags (status, opened_at DESC);

/* ── Expense agent transcript ─────────────────────────────── */

CREATE TABLE IF NOT EXISTS agent_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  person_id  uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES agent_conversations (id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_messages_conversation_idx
  ON agent_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES agent_messages (id) ON DELETE CASCADE,
  tool       text NOT NULL,
  detail     text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS agent_tool_calls_message_idx
  ON agent_tool_calls (message_id, sort_order);

/* ── Connectors ───────────────────────────────────────────── */

-- One row per connected system: a remote HTTP/SSE MCP server, or a Google
-- account connected over OAuth. Secrets live in `secret_cipher`
-- (AES-256-GCM, see lib/crypto.ts) and are never returned to the client.
CREATE TABLE IF NOT EXISTS connectors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL CHECK (kind IN ('mcp', 'google_gmail', 'google_calendar')),
  name           text NOT NULL,
  url            text,
  transport      text NOT NULL DEFAULT 'http' CHECK (transport IN ('http', 'sse')),
  auth_type      text NOT NULL DEFAULT 'none'
                   CHECK (auth_type IN ('none', 'bearer', 'api-key', 'basic', 'oauth2')),
  header_name    text,
  secret_cipher  text,
  oauth_scopes   text[] NOT NULL DEFAULT '{}',
  token_expires_at timestamptz,
  account_label  text,
  metadata       jsonb NOT NULL DEFAULT '{}',
  is_enabled     boolean NOT NULL DEFAULT true,
  status         text NOT NULL DEFAULT 'unverified'
                   CHECK (status IN ('unverified', 'pending_auth', 'connected', 'error', 'disabled')),
  status_detail  text,
  tool_count     integer,
  last_checked_at timestamptz,
  created_by     uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS connectors_name_key ON connectors (lower(name));

DROP TRIGGER IF EXISTS trg_connectors_updated_at ON connectors;
CREATE TRIGGER trg_connectors_updated_at BEFORE UPDATE ON connectors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS connector_tools (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES connectors (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, name)
);

CREATE TABLE IF NOT EXISTS connector_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES connectors (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('created', 'updated', 'check', 'auth', 'deleted')),
  ok           boolean NOT NULL,
  message      text NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connector_events_connector_idx
  ON connector_events (connector_id, occurred_at DESC);

-- Short-lived OAuth state, consumed by the Google callback route.
-- `redirect_uri` is the exact value sent in the authorization request (derived
-- from whichever host the browser was actually using — localhost, a LAN IP, a
-- Tailscale hostname, …). The callback reuses it verbatim for the token
-- exchange, since Google requires the two to match exactly.
CREATE TABLE IF NOT EXISTS oauth_states (
  state        text PRIMARY KEY,
  connector_id uuid NOT NULL REFERENCES connectors (id) ON DELETE CASCADE,
  redirect_uri text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS redirect_uri text;

/* ── LLM providers ────────────────────────────────────────── */

-- Any OpenAI-compatible chat endpoint: OpenAI itself, or a local server such
-- as LM Studio / Ollama / vLLM. `base_url` is the API root including any
-- version path (e.g. "http://100.94.50.121:1234/v1") — "/models" and
-- "/chat/completions" are appended to it. `api_key_cipher` is optional since
-- most local servers don't check one.
CREATE TABLE IF NOT EXISTS llm_providers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  base_url          text NOT NULL,
  -- Picked from `available_models` after testing, not typed up front — null
  -- until the first successful test, which fills it in automatically.
  model             text,
  api_key_cipher    text,
  is_default        boolean NOT NULL DEFAULT false,
  -- Which provider the Gmail cleanup worker calls to judge/explain a message —
  -- independent of the general default, so a smaller/cheaper local model can
  -- be assigned to bulk inbox analysis while a different one stays default.
  is_email_analyzer boolean NOT NULL DEFAULT false,
  is_enabled        boolean NOT NULL DEFAULT true,
  status            text NOT NULL DEFAULT 'unverified'
                      CHECK (status IN ('unverified', 'connected', 'error', 'disabled')),
  status_detail     text,
  available_models  jsonb NOT NULL DEFAULT '[]',
  last_checked_at   timestamptz,
  created_by        uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Migrations for a table that may already exist from before these columns did
-- — must run before the indexes/constraints below that depend on them.
ALTER TABLE llm_providers ALTER COLUMN model DROP NOT NULL;
ALTER TABLE llm_providers ADD COLUMN IF NOT EXISTS is_email_analyzer boolean NOT NULL DEFAULT false;

/* ── Gmail cleanup ────────────────────────────────────────── */

-- One row per inbox scan the worker (worker/gmail-cleanup.ts) runs. The scan
-- itself executes as a BullMQ job — this is the durable record of what it did,
-- since job data in Redis is pruned after completion.
CREATE TABLE IF NOT EXISTS cleanup_scans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id      uuid NOT NULL REFERENCES connectors (id) ON DELETE CASCADE,
  -- The Gmail label this run was scoped to, or null for the whole inbox.
  label             text,
  status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'completed', 'failed')),
  messages_scanned  integer NOT NULL DEFAULT 0,
  candidates_found  integer NOT NULL DEFAULT 0,
  analyzer_provider text,
  error_detail      text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

ALTER TABLE cleanup_scans ADD COLUMN IF NOT EXISTS label text;
-- The BullMQ job id running this scan, so the SSE progress endpoint
-- (app/api/gmail-jobs/[jobId]/route.ts) knows what to subscribe to.
ALTER TABLE cleanup_scans ADD COLUMN IF NOT EXISTS job_id text;

CREATE INDEX IF NOT EXISTS cleanup_scans_connector_idx
  ON cleanup_scans (connector_id, started_at DESC);

-- A message the heuristics (optionally refined by an LLM pass) think is safe
-- to delete. Never deleted automatically — `status` moves to 'trashed' only
-- when the user acts on it via /email/cleanup, and that action calls Gmail's
-- reversible `messages.trash`, never a permanent delete.
CREATE TABLE IF NOT EXISTS cleanup_candidates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id          uuid NOT NULL REFERENCES cleanup_scans (id) ON DELETE CASCADE,
  connector_id     uuid NOT NULL REFERENCES connectors (id) ON DELETE CASCADE,
  message_id       text NOT NULL,
  thread_id        text,
  subject          text NOT NULL DEFAULT '',
  from_address     text NOT NULL DEFAULT '',
  received_at      timestamptz,
  size_estimate    integer NOT NULL DEFAULT 0,
  heuristic_reason text NOT NULL,
  llm_reason       text,
  confidence       text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  status           text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'trashed', 'dismissed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  UNIQUE (connector_id, message_id)
);

CREATE INDEX IF NOT EXISTS cleanup_candidates_review_idx
  ON cleanup_candidates (connector_id, status, received_at);

CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_name_key ON llm_providers (lower(name));
-- At most one default at a time — the row features fall back to when none is named.
CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_one_default
  ON llm_providers ((is_default)) WHERE is_default;
-- At most one email analyzer at a time.
CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_one_email_analyzer
  ON llm_providers ((is_email_analyzer)) WHERE is_email_analyzer;

DROP TRIGGER IF EXISTS trg_llm_providers_updated_at ON llm_providers;
CREATE TRIGGER trg_llm_providers_updated_at BEFORE UPDATE ON llm_providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* ── Organizations (multi-tenant) ─────────────────────────────
   The app is multi-tenant: every signed-in person belongs to exactly one
   organization, and every customer/job/quote/schedule entry/task below is
   scoped to one. See lib/auth.ts for how a Google sign-in resolves to a
   person + org.
*/
CREATE TABLE IF NOT EXISTS organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- `people` doubles as the app's account table: a signed-in person is a row
-- with `google_sub` set. Rows without it are pre-auth seed/demo data, kept
-- only for historical display (e.g. `invoices.approver_id`) — they can never
-- sign in. Replaces the old "is_current" single-signed-in-person hack now
-- that real sessions exist (see the `sessions` table below).
ALTER TABLE people ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS google_sub text UNIQUE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE people ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
CREATE INDEX IF NOT EXISTS people_org_idx ON people (org_id);

ALTER TABLE people DROP CONSTRAINT IF EXISTS people_role_check;
ALTER TABLE people ADD CONSTRAINT people_role_check CHECK (role IN ('owner', 'approver', 'member', 'crew'));

DROP INDEX IF EXISTS people_one_current;
ALTER TABLE people DROP COLUMN IF EXISTS is_current;

-- An email invited to an org before it has ever signed in — accepted (turned
-- into a `people` row in that org, with this role) the first time that email
-- completes Google login. Pending invites are globally unique by email so an
-- address never has to guess which org it's about to join.
CREATE TABLE IF NOT EXISTS org_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'crew' CHECK (role IN ('owner', 'approver', 'member', 'crew')),
  invited_by  uuid REFERENCES people (id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_pending_email
  ON org_invites (lower(email)) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS org_invites_org_idx ON org_invites (org_id);

-- Database-backed sessions for cookie-based login (lib/auth.ts). The cookie
-- itself is a signed JWT wrapping this row's id and its own expiry, so a
-- request can reject a tampered/expired cookie without a database round trip;
-- the row still lets a session be revoked server-side (sign-out, or deleting
-- a teammate).
CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_person_idx ON sessions (person_id);

-- Connectors and LLM providers predate multi-tenancy — scope them to an org
-- like everything above, backfilling existing rows to a bootstrap org so
-- nothing already configured goes missing (the first real Google sign-in
-- claims that bootstrap org — see lib/auth.ts).
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE llm_providers ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;

DO $$
DECLARE
  bootstrap_org_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM connectors WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM llm_providers WHERE org_id IS NULL) THEN
    INSERT INTO organizations (name) VALUES ('My Company') RETURNING id INTO bootstrap_org_id;
    UPDATE connectors SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE llm_providers SET org_id = bootstrap_org_id WHERE org_id IS NULL;
  END IF;
END $$;

ALTER TABLE connectors ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE llm_providers ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS connectors_org_idx ON connectors (org_id);
DROP INDEX IF EXISTS connectors_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS connectors_org_name_key ON connectors (org_id, lower(name));

CREATE INDEX IF NOT EXISTS llm_providers_org_idx ON llm_providers (org_id);
DROP INDEX IF EXISTS llm_providers_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_org_name_key ON llm_providers (org_id, lower(name));
DROP INDEX IF EXISTS llm_providers_one_default;
CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_one_default_per_org ON llm_providers (org_id) WHERE is_default;
DROP INDEX IF EXISTS llm_providers_one_email_analyzer;
CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_one_email_analyzer_per_org
  ON llm_providers (org_id) WHERE is_email_analyzer;

/* ── Customers & jobs ─────────────────────────────────────────
   The spine every feature below hangs off: a customer's contact info, and a
   job (one property, one project) tracked from first quote through
   completion.
*/
CREATE TABLE IF NOT EXISTS customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name       text NOT NULL,
  email      text,
  phone      text,
  address    text,
  notes      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_org_idx ON customers (org_id, name);
DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  title       text NOT NULL,
  trade       text NOT NULL DEFAULT 'handyman-repair'
                CHECK (trade IN ('painting', 'plumbing', 'electrical', 'drywall', 'flooring',
                                  'tile', 'siding', 'deck-fence', 'paver-patio', 'handyman-repair')),
  address     text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'lead'
                CHECK (status IN ('lead', 'quoted', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  assigned_to uuid REFERENCES people (id) ON DELETE SET NULL,
  notes       text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_org_idx ON jobs (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_customer_idx ON jobs (customer_id);
DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A job's photos: the quoting flow's input (see lib/quoting.ts), and part of
-- the project record afterward. Files live on disk under UPLOADS_DIR (see
-- lib/storage.ts) — this row is the pointer plus whatever the AI quote pass
-- said about it.
CREATE TABLE IF NOT EXISTS job_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL DEFAULT 0,
  caption      text,
  uploaded_by  uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_photos_job_idx ON job_photos (job_id, created_at);

-- Any other file worth keeping against a job — a permit PDF, a signed
-- contract, a supplier receipt.
CREATE TABLE IF NOT EXISTS job_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL DEFAULT 0,
  uploaded_by  uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_files_job_idx ON job_files (job_id, created_at);

-- Invoices can optionally be tied back to the job they were spent on, for the
-- project record's "track invoices" view. Nullable — the personal-expense
-- side of the app (unrelated bills) leaves this unset.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_job_idx ON invoices (job_id);

/* ── Quoting ──────────────────────────────────────────────────
   An AI-assisted estimate: photos in, a line-itemized quote out. See
   lib/quoting.ts.
*/
CREATE TABLE IF NOT EXISTS estimates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  job_id       uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined')),
  summary      text NOT NULL DEFAULT '',
  subtotal     numeric(12, 2) NOT NULL DEFAULT 0,
  tax          numeric(12, 2) NOT NULL DEFAULT 0,
  total        numeric(12, 2) NOT NULL DEFAULT 0,
  ai_generated boolean NOT NULL DEFAULT false,
  sent_at      timestamptz,
  created_by   uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimates_job_idx ON estimates (job_id, created_at DESC);
DROP TRIGGER IF EXISTS trg_estimates_updated_at ON estimates;
CREATE TRIGGER trg_estimates_updated_at BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS estimate_line_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES estimates (id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    numeric(12, 2) NOT NULL DEFAULT 1,
  unit_price  numeric(12, 2) NOT NULL DEFAULT 0,
  kind        text NOT NULL DEFAULT 'labor' CHECK (kind IN ('labor', 'material', 'other')),
  sort_order  integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS estimate_line_items_estimate_idx ON estimate_line_items (estimate_id, sort_order);

/* ── Scheduling ───────────────────────────────────────────────
   One calendar entry: a job, a crew member, a time window. The daily "route"
   is just this list filtered to one person and one day, ordered by start time.
*/
CREATE TABLE IF NOT EXISTS schedule_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES people (id) ON DELETE SET NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_entries_org_idx ON schedule_entries (org_id, starts_at);
CREATE INDEX IF NOT EXISTS schedule_entries_job_idx ON schedule_entries (job_id);
CREATE INDEX IF NOT EXISTS schedule_entries_assignee_idx ON schedule_entries (assigned_to, starts_at);

/* ── Tasks ──────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  job_id      uuid REFERENCES jobs (id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'todo' CHECK (kind IN ('todo', 'shopping', 'permit')),
  title       text NOT NULL,
  due_date    date,
  assigned_to uuid REFERENCES people (id) ON DELETE SET NULL,
  is_done     boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_org_idx ON tasks (org_id, is_done, due_date);
CREATE INDEX IF NOT EXISTS tasks_job_idx ON tasks (job_id);
