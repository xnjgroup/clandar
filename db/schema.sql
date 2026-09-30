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

-- `is_current`/`people_one_current` (the pre-auth "exactly one signed-in
-- person" hack) are gone — replaced by real sessions, see the auth migration
-- further down this file.
CREATE TABLE IF NOT EXISTS people (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'approver', 'member')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

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

-- Debug trace per chat turn (lib/assistant.ts): exactly what went to the model
-- and what came back at each step — the system prompt (page/email context
-- included), the raw model output, tool calls with args/results, timings and
-- errors. Looked up by the conversation id the chat's copy button gives out.
CREATE TABLE IF NOT EXISTS agent_traces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES agent_conversations (id) ON DELETE CASCADE,
  provider        text NOT NULL DEFAULT '',
  model           text NOT NULL DEFAULT '',
  page_context    text,
  system_prompt   text NOT NULL DEFAULT '',
  user_input      text NOT NULL DEFAULT '',
  image_count     integer NOT NULL DEFAULT 0,
  steps           jsonb NOT NULL DEFAULT '[]',
  final_reply     text,
  error           text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS agent_traces_conversation_idx ON agent_traces (conversation_id, started_at);

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

/* ── Customers & projects ───────────────────────────────────────
   The spine every feature below hangs off: a customer's contact info, and a
   project (one property, one job of work) tracked from first quote through
   completion. A project's "type" (was a fixed home-improvement trade enum)
   is a per-org, user-managed list — see `project_types` below and
   lib/project-types.ts — seeded from a company-type template at /onboarding
   and freely editable after that.
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

CREATE TABLE IF NOT EXISTS project_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name       text NOT NULL,
  icon       text NOT NULL DEFAULT 'briefcase',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_types_org_name_key ON project_types (org_id, lower(name));
CREATE INDEX IF NOT EXISTS project_types_org_idx ON project_types (org_id, sort_order);

CREATE TABLE IF NOT EXISTS projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  title           text NOT NULL,
  project_type_id uuid REFERENCES project_types (id) ON DELETE SET NULL,
  address         text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'lead'
                    CHECK (status IN ('lead', 'quoted', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  assigned_to     uuid REFERENCES people (id) ON DELETE SET NULL,
  notes           text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_org_idx ON projects (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_customer_idx ON projects (customer_id);
-- When the project should be finished; optional. Shown on the project page and list.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS due_date date;
DROP TRIGGER IF EXISTS trg_jobs_updated_at ON projects;
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A project's photos: the quoting flow's input (see lib/quoting.ts), and part
-- of the project record afterward. Files live on disk under UPLOADS_DIR (see
-- lib/storage.ts) — this row is the pointer plus whatever the AI quote pass
-- said about it.
CREATE TABLE IF NOT EXISTS project_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL DEFAULT 0,
  caption      text,
  uploaded_by  uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_photos_job_idx ON project_photos (project_id, created_at);

-- Any other file worth keeping against a project — a permit PDF, a signed
-- contract, a supplier receipt.
CREATE TABLE IF NOT EXISTS project_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL DEFAULT 0,
  uploaded_by  uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_files_job_idx ON project_files (project_id, created_at);

-- Folders a project's files are organized into — nestable via `parent_id`
-- (NULL = top level). A file with no `folder_id` sits at the top level.
-- Only an empty folder can be deleted (the app enforces that), so the
-- CASCADE / SET NULL below are just a backstop.
CREATE TABLE IF NOT EXISTS project_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES project_folders (id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One name per level; the sentinel uuid stands in for NULL (top level) so the
-- uniqueness still applies there.
CREATE UNIQUE INDEX IF NOT EXISTS project_folders_name_idx
  ON project_folders (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES project_folders (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS project_files_folder_idx ON project_files (project_id, folder_id);
-- Free-form labels ("permit", "signed", "receipt"), stored lowercased and
-- deduplicated by the app; a tag filter spans every folder in the project.
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS project_files_tags_idx ON project_files USING gin (tags);
-- An uploaded invoice/receipt gets read by the LLM into an invoice record
-- (lib/document-ingest.ts); `parse_status` tracks that (NULL = never parsed,
-- which is every 'general' file) and `invoice_id` points at the result.
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'general'
  CHECK (doc_type IN ('general', 'invoice', 'receipt'));
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS parse_status text
  CHECK (parse_status IN ('pending', 'done', 'failed'));
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS parse_error text;
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices (id) ON DELETE SET NULL;

-- Invoices can optionally be tied back to the project they were spent on, for
-- the project record's "track invoices" view. Nullable — the personal-expense
-- side of the app (unrelated bills) leaves this unset.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_job_idx ON invoices (project_id);

-- The source documents behind an invoice record — the PDF/image it was read
-- from and/or the original email (.eml) it arrived in. Bytes live in storage
-- (lib/storage.ts), scoped through the invoice's org.
CREATE TABLE IF NOT EXISTS invoice_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_documents_invoice_idx ON invoice_documents (invoice_id, created_at);

/* ── Quoting ──────────────────────────────────────────────────
   An AI-assisted estimate: photos in, a line-itemized quote out. See
   lib/quoting.ts.
*/
CREATE TABLE IF NOT EXISTS estimates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS estimates_job_idx ON estimates (project_id, created_at DESC);
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
-- Set when an accepted estimate was turned into the project's work tasks (lib/quoting.ts), so it only happens once.
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS tasks_created_at timestamptz;

-- Tasks built from an accepted estimate point back at it (the project's "Work" to-do and
-- "Materials" shopping list), and their quote-made items are flagged — so re-syncing from a
-- quote (lib/quoting.ts) rebuilds just those items and leaves hand-added ones alone.
-- One-time backfill when the column first appears: link tasks made before it existed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'estimate_id') THEN
    ALTER TABLE tasks ADD COLUMN estimate_id uuid REFERENCES estimates (id) ON DELETE SET NULL;
    ALTER TABLE task_items ADD COLUMN from_estimate boolean NOT NULL DEFAULT false;
    UPDATE tasks t SET estimate_id = (
        SELECT e.id FROM estimates e
         WHERE e.project_id = t.project_id AND e.tasks_created_at IS NOT NULL
         ORDER BY e.tasks_created_at DESC LIMIT 1)
      FROM projects j
     WHERE j.id = t.project_id AND t.notes = 'From the accepted estimate.'
       AND t.title IN ('Work: ' || j.title, 'Materials: ' || j.title);
    UPDATE task_items i SET from_estimate = true FROM tasks t WHERE t.id = i.task_id AND t.estimate_id IS NOT NULL;
  END IF;
END $$;

/* ── Scheduling ───────────────────────────────────────────────
   One calendar entry: a project, a crew member, a time window. The daily
   "route" is just this list filtered to one person and one day, ordered by
   start time.
*/
CREATE TABLE IF NOT EXISTS schedule_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES people (id) ON DELETE SET NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_entries_org_idx ON schedule_entries (org_id, starts_at);
CREATE INDEX IF NOT EXISTS schedule_entries_job_idx ON schedule_entries (project_id);
CREATE INDEX IF NOT EXISTS schedule_entries_assignee_idx ON schedule_entries (assigned_to, starts_at);

/* ── Tasks ──────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id  uuid REFERENCES projects (id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'todo' CHECK (kind IN ('todo', 'shopping', 'reminder')),
  title       text NOT NULL,
  due_date    date,
  assigned_to uuid REFERENCES people (id) ON DELETE SET NULL,
  is_done     boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_org_idx ON tasks (org_id, is_done, due_date);
CREATE INDEX IF NOT EXISTS tasks_job_idx ON tasks (project_id);

-- 'permit' was too trade-specific for a built-in kind; it's now the generic 'reminder'.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
UPDATE tasks SET kind = 'reminder' WHERE kind = 'permit';
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('todo', 'shopping', 'reminder'));

-- Per-kind details. `notes` is shared; `store` only means something on a
-- shopping list; `remind_time`/`repeat` only on a reminder (`due_date` is the
-- day it fires, and marking a repeating one done rolls that date forward).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS store text NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_time time;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat text NOT NULL DEFAULT 'none'
  CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly', 'yearly'));

-- A to-do's checklist steps and a shopping list's items. `quantity`/`unit`
-- are only filled in for shopping items.
CREATE TABLE IF NOT EXISTS task_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  label      text NOT NULL,
  quantity   numeric(12, 2),
  unit       text NOT NULL DEFAULT '',
  is_done    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_items_task_idx ON task_items (task_id, created_at);
-- An optional reference link on a step/item (a product page, a how-to), http(s) only.
ALTER TABLE task_items ADD COLUMN IF NOT EXISTS url text;
-- Price per unit for a shopping item (line total = quantity × unit_price); null when unknown.
ALTER TABLE task_items ADD COLUMN IF NOT EXISTS unit_price numeric(12, 2);

-- Firing reminders (lib/reminders.ts). A reminder is due at due_date +
-- remind_time (09:00 when unset) as wall-clock time in `time_zone` — the zone
-- of whoever last saved it. `reminded_at` marks the current occurrence as
-- sent; it's cleared when the date/time changes or a repeat rolls forward.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'UTC';
-- Added with a one-time backfill: reminders already past due when firing was
-- introduced count as sent, so switching it on doesn't flood everyone. Later
-- runs of this file skip the block (the column exists), so a reminder that
-- comes due while the server is down still fires when it's back.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'reminded_at') THEN
    ALTER TABLE tasks ADD COLUMN reminded_at timestamptz;
    UPDATE tasks SET reminded_at = now() WHERE kind = 'reminder' AND due_date < current_date;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS tasks_due_reminders_idx ON tasks (due_date)
  WHERE kind = 'reminder' AND NOT is_done AND reminded_at IS NULL;

-- In-app notifications (the header bell): one row per recipient.
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_person_idx ON notifications (person_id, created_at DESC);

-- Browser push subscriptions (Web Push), one per browser/device a person enabled.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_person_idx ON push_subscriptions (person_id);

/* ── Org-scoping the legacy expense-tracking tables ──────────
   These predate multi-tenancy and were left global — every org shared the
   same locations/vendors/invoices/etc. `categories` stays global on purpose
   (a small shared reference taxonomy, not business data); everything else
   below gets its own org_id, same backfill-then-tighten pattern used for
   connectors/llm_providers above.
*/
ALTER TABLE locations ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE recurring_charges ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE fraud_flags ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations (id) ON DELETE CASCADE;

DO $$
DECLARE
  bootstrap_org_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM locations WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM vendors WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM assets WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM invoices WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM recurring_charges WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM budgets WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM alert_rules WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM alert_events WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM fraud_flags WHERE org_id IS NULL)
     OR EXISTS (SELECT 1 FROM agent_conversations WHERE org_id IS NULL) THEN
    SELECT id INTO bootstrap_org_id FROM organizations ORDER BY created_at LIMIT 1;
    IF bootstrap_org_id IS NULL THEN
      INSERT INTO organizations (name) VALUES ('My Company') RETURNING id INTO bootstrap_org_id;
    END IF;
    UPDATE locations SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE vendors SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE assets SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE invoices SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE recurring_charges SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE budgets SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE alert_rules SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE alert_events SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE fraud_flags SET org_id = bootstrap_org_id WHERE org_id IS NULL;
    UPDATE agent_conversations SET org_id = bootstrap_org_id WHERE org_id IS NULL;
  END IF;
END $$;

ALTER TABLE locations ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE vendors ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE assets ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE recurring_charges ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE budgets ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE alert_rules ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE alert_events ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE fraud_flags ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE agent_conversations ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS locations_org_idx ON locations (org_id, region, name);
CREATE INDEX IF NOT EXISTS vendors_org_idx ON vendors (org_id, name);
CREATE INDEX IF NOT EXISTS assets_org_idx ON assets (org_id);
CREATE INDEX IF NOT EXISTS invoices_org_idx ON invoices (org_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS recurring_charges_org_idx ON recurring_charges (org_id);
CREATE INDEX IF NOT EXISTS budgets_org_idx ON budgets (org_id);
CREATE INDEX IF NOT EXISTS alert_rules_org_idx ON alert_rules (org_id);
CREATE INDEX IF NOT EXISTS alert_events_org_idx ON alert_events (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS fraud_flags_org_idx ON fraud_flags (org_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS agent_conversations_org_idx ON agent_conversations (org_id, created_at DESC);

-- What used to be global-uniqueness constraints become per-org ones.
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS locations_org_name_key ON locations (org_id, lower(name));

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS vendors_org_name_key ON vendors (org_id, lower(name));
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS vendors_org_slug_key ON vendors (org_id, slug);

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_identifier_key;
CREATE UNIQUE INDEX IF NOT EXISTS assets_org_identifier_key ON assets (org_id, identifier);

ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_label_key;
CREATE UNIQUE INDEX IF NOT EXISTS budgets_org_label_key ON budgets (org_id, lower(label));

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_label_key;
CREATE UNIQUE INDEX IF NOT EXISTS alert_rules_org_label_key ON alert_rules (org_id, lower(label));

-- Whether the owner has set a real company name yet — false on every
-- freshly-created org (see lib/auth.ts's resolvePersonForLogin), which sends
-- them to /onboarding on their first sign-in instead of straight to the
-- dashboard. Backfilled true here so an org that already existed before this
-- column was added is never unexpectedly interrupted.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT true;
ALTER TABLE organizations ALTER COLUMN onboarded DROP DEFAULT;
ALTER TABLE organizations ALTER COLUMN onboarded SET DEFAULT false;

/* ── Scheduled AI tasks ───────────────────────────────────────
   A recurring automation: on its schedule, a worker (lib/scheduled-tasks-worker.ts)
   gathers a snapshot of the org's real business data, sends it plus `prompt` to
   the org's default LLM provider, and records the result as a run — never
   sends anything to a customer or changes any data on its own.
*/
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  icon         text NOT NULL DEFAULT 'bot',
  prompt       text NOT NULL,
  frequency    text NOT NULL CHECK (frequency IN ('daily', 'weekdays', 'weekly')),
  run_time     time NOT NULL DEFAULT '08:00',
  -- Only meaningful (and required) for frequency = 'weekly': 0 = Sunday .. 6 = Saturday.
  run_weekday  integer CHECK (run_weekday BETWEEN 0 AND 6),
  is_enabled   boolean NOT NULL DEFAULT true,
  last_run_at  timestamptz,
  next_run_at  timestamptz NOT NULL,
  created_by   uuid REFERENCES people (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- The zone run_time is wall-clock time in (the browser's, when it was last set) — see lib/time-zone.ts.
ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'UTC';
CREATE INDEX IF NOT EXISTS scheduled_tasks_org_idx ON scheduled_tasks (org_id, created_at DESC);
-- What the scheduler tick (lib/scheduled-tasks-worker.ts) polls every few minutes.
CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx ON scheduled_tasks (next_run_at) WHERE is_enabled;

CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES scheduled_tasks (id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  output      text,
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS scheduled_task_runs_task_idx ON scheduled_task_runs (task_id, started_at DESC);

/* ── Platform LLM providers (admin-only) ─────────────────────
   Same shape as `llm_providers`, but with no `org_id` — configured at
   /admin by whoever's email is in ADMIN_EMAILS (see lib/admin.ts), and used
   as the fallback default for any org that hasn't configured (or enabled)
   its own provider. An org's own provider always wins when it has one —
   see `defaultLlmProvider` in lib/llm-providers.ts.
*/
CREATE TABLE IF NOT EXISTS platform_llm_providers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  base_url          text NOT NULL,
  model             text,
  api_key_cipher    text,
  is_default        boolean NOT NULL DEFAULT false,
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
CREATE UNIQUE INDEX IF NOT EXISTS platform_llm_providers_name_key ON platform_llm_providers (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS platform_llm_providers_one_default
  ON platform_llm_providers ((is_default)) WHERE is_default;

DROP TRIGGER IF EXISTS trg_platform_llm_providers_updated_at ON platform_llm_providers;
CREATE TRIGGER trg_platform_llm_providers_updated_at BEFORE UPDATE ON platform_llm_providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What a new org's owner picks at /onboarding (see lib/project-types.ts's
-- COMPANY_TYPES) — for reference only, since seeding project_types already
-- happened by the time this is read back. Nullable since an org created
-- before this existed has none recorded. (`projects`/`project_types` and the
-- rest of the former "jobs" naming live in the Customers & projects section
-- above — this used to be a separate rename migration, folded in once every
-- environment had run it.)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_type text;
-- The company header on emails sent to customers (lib/letterhead.ts): companyName, address, phone, email, website, license.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS letterhead jsonb NOT NULL DEFAULT '{}';

/* ── Executive Assistant chat attachments ─────────────────────
   An image or document a user attached in the assistant chat (see
   lib/assistant.ts, lib/document-extract.ts). Bytes live on disk under
   UPLOADS_DIR (lib/storage.ts) like project photos/files do — this row is
   the pointer, streamed back through /api/assistant/attachments/[id],
   gated by the message's own conversation/org check.
*/
CREATE TABLE IF NOT EXISTS agent_message_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES agent_messages (id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS agent_message_attachments_message_idx
  ON agent_message_attachments (message_id, sort_order);

-- Archiving a conversation hides it from the switcher's default list without
-- deleting anything — see lib/assistant.ts's archiveConversation/listConversations.
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- A third per-org LLM assignment, alongside "default" and "email analyzer":
-- which provider the Executive Assistant chat uses (lib/assistant.ts's
-- chatLlmProvider) — falls back to the org's default when unset, same
-- one-statement "at most one" pattern as the other two assignments.
ALTER TABLE llm_providers ADD COLUMN IF NOT EXISTS is_chat_provider boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_one_chat_provider_per_org
  ON llm_providers (org_id) WHERE is_chat_provider;

-- A provider's own `model` is its general-purpose default; email analysis and
-- chat can each pin a different model from that same provider (e.g. a
-- cheaper one for email triage, a stronger one for chat) — null means "use
-- the provider's own default model" for that feature.
ALTER TABLE llm_providers ADD COLUMN IF NOT EXISTS email_model text;
ALTER TABLE llm_providers ADD COLUMN IF NOT EXISTS chat_model text;

/* ── Lead finder ──────────────────────────────────────────────
   Watches the org's Gmail for project opportunities (lib/lead-finder.ts):
   new inbox mail is classified by the email AI against the org's own project
   types; real opportunities land in email_leads as a review queue, optionally
   Gmail-labelled "Leads/<type>", with a daily digest of what came in.
*/
CREATE TABLE IF NOT EXISTS lead_finder_settings (
  org_id            uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  is_enabled        boolean NOT NULL DEFAULT false,
  check_minutes     integer NOT NULL DEFAULT 15 CHECK (check_minutes IN (15, 30, 60)),
  -- How sure the AI must be (0–1) before an email counts as a lead.
  min_confidence    numeric(3, 2) NOT NULL DEFAULT 0.65,
  gmail_labels      boolean NOT NULL DEFAULT true,
  -- The owner's own rules, e.g. "Only Brooklyn and Queens; skip commercial jobs".
  instructions      text NOT NULL DEFAULT '',
  digest_enabled    boolean NOT NULL DEFAULT true,
  digest_time       time NOT NULL DEFAULT '07:30',
  time_zone         text NOT NULL DEFAULT 'UTC',
  digest_bell       boolean NOT NULL DEFAULT true,
  digest_push       boolean NOT NULL DEFAULT true,
  digest_email      boolean NOT NULL DEFAULT true,
  last_scan_started_at timestamptz,
  last_scan_at      timestamptz,
  last_scan_note    text,
  last_digest_at    timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Per Gmail account: everything received before `scanned_through` has been looked at.
CREATE TABLE IF NOT EXISTS lead_scan_state (
  connector_id    uuid PRIMARY KEY REFERENCES connectors (id) ON DELETE CASCADE,
  scanned_through timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS email_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  connector_id    uuid NOT NULL REFERENCES connectors (id) ON DELETE CASCADE,
  message_id      text NOT NULL,
  thread_id       text NOT NULL,
  from_name       text NOT NULL DEFAULT '',
  from_email      text NOT NULL DEFAULT '',
  subject         text NOT NULL DEFAULT '',
  received_at     timestamptz,
  project_type_id uuid REFERENCES project_types (id) ON DELETE SET NULL,
  -- The type's name when classified (kept if the type is later renamed/removed), or the AI's own label.
  project_type_name text NOT NULL DEFAULT '',
  confidence      numeric(3, 2) NOT NULL DEFAULT 0,
  -- A suggested project title, a two-line summary, and extracted facts.
  title           text NOT NULL DEFAULT '',
  summary         text NOT NULL DEFAULT '',
  details         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'converted', 'dismissed')),
  project_id      uuid REFERENCES projects (id) ON DELETE SET NULL,
  gmail_label_id  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, message_id)
);
CREATE INDEX IF NOT EXISTS email_leads_org_idx ON email_leads (org_id, status, received_at DESC);

-- A person's arrangement of a dashboard's widgets (components/dashboard-grid.tsx),
-- per page: [{ i, x, y, w, h }] on a 12-column grid. Missing = the default layout.
CREATE TABLE IF NOT EXISTS dashboard_layouts (
  person_id  uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  page       text NOT NULL,
  layout     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, page)
);

