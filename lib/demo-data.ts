/**
 * Sample ("demo") data a new workspace can add to look around with — renovation jobs and a travel
 * plan — and remove in one go. Every row it creates is listed in `demo_records`, so removing it
 * deletes exactly those and nothing the person made themselves:
 *  - their own tasks / schedule entries on a sample project are kept, just unlinked from it;
 *  - a sample customer one of their own projects uses is kept;
 *  - a sample project type is removed only once nothing uses it.
 *
 * Sample customers and crew use example.com addresses (nothing can be emailed to them, and the crew
 * can't sign in), and sample reminders are marked as already sent, so the demo never notifies anyone.
 * Photos and files are each workspace's own copies (from public/demo, and generated PDFs).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "@/lib/db";
import { textPdf } from "@/lib/demo-pdf";
import { deleteUpload, saveUpload } from "@/lib/storage";
import { dateInZone, validTimeZone, zonedTimeToUtc } from "@/lib/time-zone";

export type DemoSet = "renovation" | "travel";
export const DEMO_SETS: { id: DemoSet; label: string }[] = [
  { id: "renovation", label: "Renovation jobs" },
  { id: "travel", label: "Travel plan" },
];

type Kind = "customer" | "project" | "project_type" | "task" | "schedule_entry" | "person" | "vendor" | "invoice" | "budget";

/** Whether the org has sample data, and whether it has any of its own projects/customers too. */
export async function demoStatus(orgId: string): Promise<{ hasDemo: boolean; hasOwnData: boolean; isEmpty: boolean }> {
  const row = await queryOne<{ demo: number; own_projects: number; own_customers: number }>(
    `SELECT (SELECT count(*)::int FROM demo_records WHERE org_id = $1) AS demo,
            (SELECT count(*)::int FROM projects p WHERE p.org_id = $1
               AND NOT EXISTS (SELECT 1 FROM demo_records d WHERE d.kind = 'project' AND d.record_id = p.id)) AS own_projects,
            (SELECT count(*)::int FROM customers c WHERE c.org_id = $1
               AND NOT EXISTS (SELECT 1 FROM demo_records d WHERE d.kind = 'customer' AND d.record_id = c.id)) AS own_customers`,
    [orgId],
  );
  const hasDemo = (row?.demo ?? 0) > 0;
  const hasOwnData = (row?.own_projects ?? 0) + (row?.own_customers ?? 0) > 0;
  return { hasDemo, hasOwnData, isEmpty: !hasDemo && !hasOwnData };
}

/** The record ids of one kind that are sample data — e.g. so the assistant can say so. */
export async function demoRecordIds(orgId: string, kind: Kind): Promise<Set<string>> {
  const rows = await query<{ record_id: string }>(`SELECT record_id FROM demo_records WHERE org_id = $1 AND kind = $2`, [orgId, kind]);
  return new Set(rows.map((r) => r.record_id));
}

/** Adds the chosen sample sets (skipping any already added). */
export async function addDemoData(
  orgId: string,
  personId: string | null,
  sets: DemoSet[],
  timeZone: string,
  /** The site's origin — sample photos are fetched from /demo/… when they aren't on disk. */
  origin: string,
): Promise<{ projects: number }> {
  const tz = validTimeZone(timeZone);
  const today = dateInZone(new Date(), tz);
  // A set already added (its sample project is still here) isn't added twice.
  const existing = (
    await query<{ title: string }>(
      `SELECT p.title FROM projects p JOIN demo_records d ON d.kind = 'project' AND d.record_id = p.id WHERE p.org_id = $1`,
      [orgId],
    )
  ).map((r) => r.title);
  let projects = 0;
  const uploaded: string[] = [];
  try {
    await transaction(async (client) => {
      const seed = new Seeder(client, orgId, personId, tz, today, origin, uploaded);
      if (sets.includes("renovation") && !existing.includes(RENOVATION_PROJECT)) projects += await seed.renovation();
      if (sets.includes("travel") && !existing.includes(TRAVEL_PROJECT)) projects += await seed.travel();
      await seed.flush();
    });
  } catch (error) {
    // Nothing was saved — don't leave its photos and files behind in storage.
    await Promise.all(uploaded.map((key) => deleteUpload(key).catch(() => {})));
    throw error;
  }
  return { projects };
}

/** Removes all sample data (see the top of this file for what's kept). */
export async function removeDemoData(orgId: string): Promise<void> {
  const stored = await transaction(async (client) => {
    const ids = async (kind: Kind) =>
      (await client.query<{ record_id: string }>(`SELECT record_id FROM demo_records WHERE org_id = $1 AND kind = $2`, [orgId, kind])).rows.map(
        (r) => r.record_id,
      );
    const projects = await ids("project");
    const tasks = await ids("task");
    const entries = await ids("schedule_entry");
    const customers = await ids("customer");
    const types = await ids("project_type");
    const people = await ids("person");
    const vendors = await ids("vendor");
    const invoices = await ids("invoice");
    const budgets = await ids("budget");
    // The sample projects' photos and files, to delete from storage once the rows are gone.
    const files = (
      await client.query<{ file_path: string }>(
        `SELECT file_path FROM project_photos WHERE project_id = ANY($1::uuid[])
         UNION ALL SELECT file_path FROM project_files WHERE project_id = ANY($1::uuid[])`,
        [projects],
      )
    ).rows.map((r) => r.file_path);

    // The person's own tasks / schedule entries on a sample project: keep them, unlinked.
    await client.query(`UPDATE tasks SET project_id = NULL WHERE org_id = $1 AND project_id = ANY($2::uuid[]) AND NOT (id = ANY($3::uuid[]))`, [
      orgId,
      projects,
      tasks,
    ]);
    await client.query(
      `UPDATE schedule_entries SET project_id = NULL WHERE org_id = $1 AND project_id = ANY($2::uuid[]) AND NOT (id = ANY($3::uuid[]))`,
      [orgId, projects, entries],
    );
    await client.query(`DELETE FROM tasks WHERE org_id = $1 AND id = ANY($2::uuid[])`, [orgId, tasks]);
    await client.query(`DELETE FROM schedule_entries WHERE org_id = $1 AND id = ANY($2::uuid[])`, [orgId, entries]);
    // Estimates, photos, comments … go with their project.
    await client.query(`DELETE FROM projects WHERE org_id = $1 AND id = ANY($2::uuid[])`, [orgId, projects]);
    // A sample customer that one of their own projects uses stays.
    await client.query(
      `DELETE FROM customers c WHERE c.org_id = $1 AND c.id = ANY($2::uuid[])
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.customer_id = c.id)`,
      [orgId, customers],
    );
    await client.query(
      `DELETE FROM project_types t WHERE t.org_id = $1 AND t.id = ANY($2::uuid[])
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.project_type_id = t.id)`,
      [orgId, types],
    );
    // Sample bills and budgets; a sample supplier stays if one of their own invoices uses it.
    await client.query(`DELETE FROM invoices WHERE org_id = $1 AND id = ANY($2::uuid[])`, [orgId, invoices]);
    await client.query(`DELETE FROM budgets WHERE org_id = $1 AND id = ANY($2::uuid[])`, [orgId, budgets]);
    await client.query(
      `DELETE FROM vendors v WHERE v.org_id = $1 AND v.id = ANY($2::uuid[])
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.vendor_id = v.id)`,
      [orgId, vendors],
    );
    // The sample crew (their visits and tasks are already gone; anything else of theirs is unassigned).
    await client.query(`DELETE FROM people WHERE org_id = $1 AND id = ANY($2::uuid[])`, [orgId, people]);
    await client.query(`DELETE FROM demo_records WHERE org_id = $1`, [orgId]);
    return files;
  });
  await Promise.all(stored.map((key) => deleteUpload(key).catch(() => {})));
}

// Each set's main project — how a set already added is recognized.
const RENOVATION_PROJECT = "Kitchen remodel — Parker home";
const TRAVEL_PROJECT = "Portugal — Lisbon & Porto";

/** Writes one set's rows inside the caller's transaction, recording each in demo_records. */
class Seeder {
  constructor(
    private readonly client: PoolClient,
    private readonly orgId: string,
    private readonly personId: string | null,
    private readonly tz: string,
    private readonly today: string,
    private readonly origin: string,
    /** Storage keys written so far — removed again if the transaction fails. */
    private readonly uploaded: string[],
  ) {}

  /** A YYYY-MM-DD `offset` days from today. */
  private day(offset: number): string {
    const d = new Date(`${this.today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  /** A moment: `offset` days from today at HH:MM wall-clock time in the person's zone. */
  private at(offset: number, time: string): Date {
    return zonedTimeToUtc(this.day(offset), time, this.tz) ?? new Date();
  }

  /** Rows to record in demo_records — written in one go by flush(). */
  private marks: { kind: Kind; id: string }[] = [];

  private async mark(kind: Kind, id: string) {
    this.marks.push({ kind, id });
  }

  async flush() {
    // The photos and files, uploaded in parallel, then pointed at.
    const stored = await Promise.all(
      this.uploads.map(async (u) => {
        const bytes = await u.bytes();
        const key = await saveUpload(u.category, u.projectId, u.name, bytes);
        this.uploaded.push(key);
        return { ...u, key, size: bytes.length };
      }),
    );
    for (const table of ["project_photos", "project_files"] as const) {
      const rows = stored.filter((u) => u.table === table);
      if (rows.length === 0) continue;
      await this.client.query(
        `UPDATE ${table} t SET file_path = u.key, size_bytes = u.size
           FROM unnest($1::uuid[], $2::text[], $3::int[]) AS u(id, key, size) WHERE t.id = u.id`,
        [rows.map((u) => u.id), rows.map((u) => u.key), rows.map((u) => u.size)],
      );
    }
    this.uploads = [];
    if (this.marks.length === 0) return;
    await this.client.query(
      `INSERT INTO demo_records (org_id, kind, record_id)
       SELECT $1, k, r FROM unnest($2::text[], $3::uuid[]) AS m(k, r) ON CONFLICT DO NOTHING`,
      [this.orgId, this.marks.map((m) => m.kind), this.marks.map((m) => m.id)],
    );
    this.marks = [];
  }

  private async one(sql: string, params: unknown[]): Promise<string> {
    return (await this.client.query<{ id: string }>(sql, params)).rows[0].id;
  }

  /** An existing project type with this name, or a new (sample) one. */
  private async projectType(name: string, icon: string): Promise<string> {
    const found = await this.client.query<{ id: string }>(`SELECT id FROM project_types WHERE org_id = $1 AND lower(name) = lower($2)`, [
      this.orgId,
      name,
    ]);
    if (found.rows[0]) return found.rows[0].id;
    const id = await this.one(
      `INSERT INTO project_types (org_id, name, icon, sort_order)
       VALUES ($1, $2, $3, (SELECT coalesce(max(sort_order), -1) + 1 FROM project_types WHERE org_id = $1)) RETURNING id`,
      [this.orgId, name, icon],
    );
    await this.mark("project_type", id);
    return id;
  }

  private async customer(c: { name: string; email: string | null; phone: string | null; address: string | null; notes?: string }) {
    const id = await this.one(`INSERT INTO customers (org_id, name, email, phone, address, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [
      this.orgId,
      c.name,
      c.email,
      c.phone,
      c.address,
      c.notes ?? "",
    ]);
    await this.mark("customer", id);
    return id;
  }

  private async project(p: {
    customerId: string;
    title: string;
    typeId: string;
    address: string;
    status: string;
    notes: string;
    dueIn: number | null;
  }) {
    const id = await this.one(
      `INSERT INTO projects (org_id, customer_id, title, project_type_id, address, status, notes, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [this.orgId, p.customerId, p.title, p.typeId, p.address, p.status, p.notes, p.dueIn === null ? null : this.day(p.dueIn), this.personId],
    );
    await this.mark("project", id);
    return id;
  }

  private async entry(e: {
    projectId: string | null;
    day: number;
    from: string;
    to: string;
    toDay?: number;
    notes: string;
    location?: string;
    lat?: number;
    lng?: number;
    /** Who it's assigned to — the person adding the sample by default. */
    who?: string | null;
  }) {
    const id = await this.one(
      `INSERT INTO schedule_entries (org_id, project_id, assigned_to, starts_at, ends_at, notes, location, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        this.orgId,
        e.projectId,
        e.who === undefined ? this.personId : e.who,
        this.at(e.day, e.from),
        this.at(e.toDay ?? e.day, e.to),
        e.notes,
        e.location ?? "",
        e.lat ?? null,
        e.lng ?? null,
      ],
    );
    await this.mark("schedule_entry", id);
  }

  private async task(t: {
    projectId: string | null;
    kind: "todo" | "shopping" | "reminder";
    title: string;
    notes?: string;
    dueIn: number | null;
    store?: string;
    done?: boolean;
    items?: { label: string; done?: boolean; quantity?: number; unit?: string; price?: number; url?: string }[];
    who?: string | null;
  }) {
    const id = await this.one(
      `INSERT INTO tasks (org_id, project_id, kind, title, notes, due_date, store, assigned_to, created_by, time_zone, is_done, done_at, reminded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $11, $9, $10, CASE WHEN $10 THEN now() END,
               -- Sample reminders never fire.
               CASE WHEN $3 = 'reminder' THEN now() END)
       RETURNING id`,
      [this.orgId, t.projectId, t.kind, t.title, t.notes ?? "", t.dueIn === null ? null : this.day(t.dueIn), t.store ?? "", t.who === undefined ? this.personId : t.who, this.tz, t.done ?? false, this.personId],
    );
    const items = t.items ?? [];
    if (items.length > 0) {
      // One statement for all the items; clock_timestamp() keeps them in order.
      await this.client.query(
        `INSERT INTO task_items (task_id, label, is_done, quantity, unit, unit_price, url, created_at)
         SELECT $1, label, done, qty, unit, price, link, clock_timestamp() + (n || ' ms')::interval
           FROM unnest($2::text[], $3::bool[], $4::numeric[], $5::text[], $6::numeric[], $7::text[])
                WITH ORDINALITY AS i(label, done, qty, unit, price, link, n)`,
        [
          id,
          items.map((i) => i.label),
          items.map((i) => i.done ?? false),
          items.map((i) => i.quantity ?? null),
          items.map((i) => i.unit ?? ""),
          items.map((i) => i.price ?? null),
          items.map((i) => i.url ?? null),
        ],
      );
    }
    await this.mark("task", id);
    return id;
  }

  /** A sample crew member: in the people list and on the schedule, but can't sign in. */
  private async crewMember(name: string): Promise<string> {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, ".");
    const id = await this.one(`INSERT INTO people (org_id, name, email, role) VALUES ($1, $2, $3, 'crew') RETURNING id`, [
      this.orgId,
      name,
      `${slug}+${this.orgId.slice(0, 8)}.${Date.now().toString(36)}@example.com`,
    ]);
    await this.mark("person", id);
    return id;
  }

  /** A supplier: the org's own one with this name, or a new (sample) one. */
  private async vendor(name: string, category: string): Promise<string> {
    const found = await this.client.query<{ id: string }>(`SELECT id FROM vendors WHERE org_id = $1 AND lower(name) = lower($2)`, [this.orgId, name]);
    if (found.rows[0]) return found.rows[0].id;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const id = await this.one(`INSERT INTO vendors (org_id, name, slug, category) VALUES ($1, $2, $3, $4) RETURNING id`, [this.orgId, name, slug, category]);
    await this.mark("vendor", id);
    return id;
  }

  /** A bill or receipt, with its lines; `flag` adds an alert to review. */
  private async invoice(i: {
    vendorId: string;
    category: string;
    projectId: string | null;
    daysAgo: number;
    status: "approved" | "pending_review" | "flagged";
    payment?: string;
    dueIn?: number;
    lines: { d: string; a: number; tag?: "one-time" | "recurring" | "tax" | "credit" }[];
    flag?: string;
  }): Promise<string> {
    const amount = Math.round(i.lines.reduce((sum, l) => sum + l.a, 0) * 100) / 100;
    const id = await this.one(
      `INSERT INTO invoices (org_id, vendor_id, category, project_id, invoice_date, due_date, amount, status, payment_method,
                             submitted_by, approver_id, decided_at, ocr_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Sample data', CASE WHEN $8 = 'approved' THEN $10::uuid END,
               CASE WHEN $8 = 'approved' THEN now() END, 0.97)
       RETURNING id`,
      [
        this.orgId,
        i.vendorId,
        i.category,
        i.projectId,
        this.day(-i.daysAgo),
        i.dueIn === undefined ? null : this.day(i.dueIn),
        amount,
        i.status,
        i.payment ?? null,
        this.personId,
      ],
    );
    await this.client.query(
      `INSERT INTO invoice_line_items (invoice_id, group_label, tag, description, amount, sort_order)
       SELECT $1, 'Items', tag, d, a, n - 1 FROM unnest($2::text[], $3::numeric[], $4::text[]) WITH ORDINALITY AS l(d, a, tag, n)`,
      [id, i.lines.map((l) => l.d), i.lines.map((l) => l.a), i.lines.map((l) => l.tag ?? "one-time")],
    );
    if (i.flag) await this.client.query(`INSERT INTO invoice_flags (invoice_id, label) VALUES ($1, $2)`, [id, i.flag]);
    await this.mark("invoice", id);
    return id;
  }

  /** A monthly budget (skipped when the org already has one with this label). */
  private async budget(label: string, category: string | null, cap: number) {
    const found = await this.client.query(`SELECT 1 FROM budgets WHERE org_id = $1 AND lower(label) = lower($2)`, [this.orgId, label]);
    if (found.rows[0]) return;
    const id = await this.one(
      `INSERT INTO budgets (org_id, label, category, monthly_cap, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT coalesce(max(sort_order), -1) + 1 FROM budgets WHERE org_id = $1)) RETURNING id`,
      [this.orgId, label, category, cap],
    );
    await this.mark("budget", id);
  }

  /** A sample photo's bytes: from public/demo on disk, else from the site itself. */
  private async asset(name: string): Promise<Buffer> {
    try {
      return await readFile(join(/*turbopackIgnore: true*/ process.cwd(), "public", "demo", name));
    } catch {
      const response = await fetch(new URL(`/demo/${name}`, this.origin));
      if (!response.ok) throw new Error(`Sample photo ${name} is missing (${response.status}).`);
      return Buffer.from(await response.arrayBuffer());
    }
  }

  /**
   * Photos and files are inserted straight away (so comments can reference them) and uploaded all at
   * once in flush() — one at a time, the uploads were most of the wait.
   */
  private uploads: { table: "project_photos" | "project_files"; id: string; category: string; projectId: string; name: string; bytes: () => Promise<Buffer> }[] = [];

  /** A project photo (this workspace's own copy, from public/demo). */
  private async photo(projectId: string, name: string, caption: string, daysAgo: number): Promise<string> {
    const id = await this.one(
      `INSERT INTO project_photos (project_id, file_path, content_type, caption, uploaded_by, created_at)
       VALUES ($1, '', 'image/jpeg', $2, $3, now() - make_interval(days => $4)) RETURNING id`,
      [projectId, caption, this.personId, daysAgo],
    );
    this.uploads.push({ table: "project_photos", id, category: "project-photos", projectId, name, bytes: () => this.asset(name) });
    return id;
  }

  /** A project file: a generated one-page PDF, optionally tagged. */
  private async file(projectId: string, fileName: string, title: string, lines: string[], tags: string[] = []): Promise<string> {
    const id = await this.one(
      `INSERT INTO project_files (project_id, file_path, file_name, content_type, uploaded_by, tags)
       VALUES ($1, '', $2, 'application/pdf', $3, $4) RETURNING id`,
      [projectId, fileName, this.personId, tags],
    );
    this.uploads.push({ table: "project_files", id, category: "project-files", projectId, name: fileName, bytes: async () => textPdf(title, lines) });
    return id;
  }

  /** A discussion comment (no one is notified); `<@id>` mentions, `<#photo:id>` references, URLs link. */
  private async comment(projectId: string, authorId: string | null, body: string, hoursAgo: number, parentId?: string): Promise<string> {
    return this.one(
      `INSERT INTO project_comments (org_id, project_id, parent_id, author_id, body, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now() - make_interval(hours => $6), now() - make_interval(hours => $6)) RETURNING id`,
      [this.orgId, projectId, parentId ?? null, authorId, body, hoursAgo],
    );
  }

  private async estimate(projectId: string, status: string, summary: string, lines: { d: string; q: number; p: number; k: "labor" | "material" | "other" }[]) {
    const subtotal = lines.reduce((sum, l) => sum + l.q * l.p, 0);
    const tax = Math.round(lines.filter((l) => l.k === "material").reduce((sum, l) => sum + l.q * l.p, 0) * 0.07 * 100) / 100;
    const id = await this.one(
      `INSERT INTO estimates (org_id, project_id, status, summary, subtotal, tax, total, sent_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $3 <> 'draft' THEN now() - interval '3 days' END, $8) RETURNING id`,
      [this.orgId, projectId, status, summary, subtotal, tax, subtotal + tax, this.personId],
    );
    await this.client.query(
      `INSERT INTO estimate_line_items (estimate_id, description, quantity, unit_price, kind, sort_order)
       SELECT $1, d, q, p, k, n - 1 FROM unnest($2::text[], $3::numeric[], $4::numeric[], $5::text[]) WITH ORDINALITY AS l(d, q, p, k, n)`,
      [id, lines.map((l) => l.d), lines.map((l) => l.q), lines.map((l) => l.p), lines.map((l) => l.k)],
    );
  }

  /**
   * A small renovation contractor: three crew members with their own week on the schedule, five jobs
   * at different stages (estimates, photos, permit and contract files, discussion, tasks with links),
   * supplier bills and receipts against the jobs, and monthly budgets.
   */
  async renovation(): Promise<number> {
    const kitchen = await this.projectType("Kitchen remodel", "fork");
    const bath = await this.projectType("Bathroom", "droplet");
    const painting = await this.projectType("Painting", "brush");
    const deck = await this.projectType("Deck & fence", "fence");

    const marcus = await this.crewMember("Marcus Reed");
    const ana = await this.crewMember("Ana Torres");
    const jake = await this.crewMember("Jake Miller");

    const parkers = await this.customer({
      name: "Emma & Ryan Parker",
      email: "parkers@example.com",
      phone: "(615) 555-0142",
      address: "2418 Belmont Blvd, Nashville, TN 37212",
      notes: "Prefer texts. Two kids and a dog — gate code 4471.",
    });
    const chen = await this.customer({
      name: "Linda Chen",
      email: "linda.chen@example.com",
      phone: "(615) 555-0187",
      address: "907 Russell St, Nashville, TN 37206",
    });
    const harbor = await this.customer({
      name: "Harbor Street Café",
      email: "owner@harborcafe.example.com",
      phone: "(615) 555-0119",
      address: "310 Harbor St, Nashville, TN 37203",
      notes: "Work only after 3 pm (closed afternoons).",
    });

    // Suppliers.
    const homeDepot = await this.vendor("Home Depot", "Materials");
    const cabinets = await this.vendor("Shaker Cabinet Co.", "Materials");
    const floorDecor = await this.vendor("Floor & Decor", "Materials");
    const sherwin = await this.vendor("Sherwin-Williams", "Materials");
    const sunbelt = await this.vendor("Sunbelt Rentals", "Tools & equipment");
    const shell = await this.vendor("Shell", "Fuel & travel");
    const nes = await this.vendor("Nashville Electric Service", "Utilities");

    // ── Kitchen remodel (in progress) ──
    const kitchenJob = await this.project({
      customerId: parkers,
      title: RENOVATION_PROJECT,
      typeId: kitchen,
      address: "2418 Belmont Blvd, Nashville, TN 37212",
      status: "in_progress",
      notes: `Shaker cabinets in sage green, quartz counters, new island with seating for 3.`,
      dueIn: 18,
    });
    await this.client.query(`UPDATE projects SET assigned_to = $2 WHERE id = $1`, [kitchenJob, marcus]);
    await this.estimate(kitchenJob, "accepted", "Full kitchen remodel: demo, cabinets, quartz counters, island, backsplash and lighting.", [
      { d: "Demolition and haul-away", q: 1, p: 1450, k: "labor" },
      { d: "Shaker cabinets (sage green), 18 boxes", q: 1, p: 9800, k: "material" },
      { d: "Quartz countertops, 52 sq ft", q: 52, p: 78, k: "material" },
      { d: "Cabinet and island install", q: 40, p: 65, k: "labor" },
      { d: "Subway tile backsplash", q: 30, p: 22, k: "material" },
      { d: "Electrical: 6 recessed lights + pendants", q: 1, p: 1150, k: "labor" },
    ]);
    const kitchenSite = { lat: 36.1335, lng: -86.7941 };
    await this.entry({ projectId: kitchenJob, day: 0, from: "08:00", to: "15:30", notes: "Cabinet install — upper run", who: marcus, ...kitchenSite });
    await this.entry({ projectId: kitchenJob, day: 1, from: "08:00", to: "15:30", notes: "Set base cabinets and island", who: marcus, ...kitchenSite });
    await this.entry({
      projectId: kitchenJob,
      day: 1,
      from: "07:30",
      to: "08:30",
      notes: "Pick up backsplash tile",
      location: "Floor & Decor, 1515 Gallatin Pike, Madison, TN",
      lat: 36.2398,
      lng: -86.7208,
    });
    await this.entry({ projectId: kitchenJob, day: 2, from: "09:00", to: "11:00", notes: "Countertop templating", ...kitchenSite });
    await this.entry({ projectId: kitchenJob, day: 8, from: "08:00", to: "16:00", notes: "Backsplash tile", who: ana, ...kitchenSite });
    const before = await this.photo(kitchenJob, "kitchen-before.jpg", "Before — the old kitchen", 20);
    const progress = await this.photo(kitchenJob, "kitchen-progress.jpg", "Cabinets going in", 1);
    await this.photo(kitchenJob, "kitchen-after.jpg", "Design inspiration — sage shaker with quartz", 25);
    await this.file(kitchenJob, "Signed contract.pdf", "Remodeling Agreement", [
      "Contractor: (your company)        Client: Emma & Ryan Parker",
      "Property: 2418 Belmont Blvd, Nashville, TN 37212",
      "",
      "## Scope",
      "Full kitchen remodel per the accepted estimate: demolition, sage shaker",
      "cabinets, quartz countertops and island, subway tile backsplash, lighting.",
      "",
      "## Price and payments",
      "Contract price: $20,732. Deposit 30% on signing; 40% at cabinet install;",
      "balance on completion and final walk-through.",
      "",
      "## Schedule",
      "Start within 7 days of signing; substantial completion in about 4 weeks.",
      "",
      "Signed: Emma Parker, Ryan Parker — (sample document)",
    ], ["signed", "contract"]);
    await this.file(kitchenJob, "Building permit.pdf", "Residential Building Permit", [
      "Permit no. B-24-08817 (sample)",
      "Address: 2418 Belmont Blvd, Nashville, TN 37212",
      "Work: interior kitchen remodel with electrical alterations",
      "",
      "## Inspections required",
      "Rough-in electrical — passed",
      "Final electrical",
      "Final building",
      "",
      "Post this permit where it can be seen from the street until final inspection.",
    ], ["permit"]);
    const checklist = await this.task({
      projectId: kitchenJob,
      kind: "todo",
      title: "Kitchen install checklist",
      dueIn: 18,
      who: marcus,
      items: [
        { label: "Demo old cabinets and counters", done: true },
        { label: "Rough-in electrical for pendants", done: true },
        { label: "Hang upper cabinets" },
        { label: "Set base cabinets and island" },
        { label: "Template and install quartz" },
        { label: "Tile backsplash and grout" },
        { label: "Final walk-through with Emma & Ryan" },
      ],
    });
    await this.task({
      projectId: kitchenJob,
      kind: "shopping",
      title: "Kitchen materials",
      store: "Home Depot",
      dueIn: 1,
      items: [
        { label: "Cabinet screws, 2-1/2 in", quantity: 2, unit: "box", price: 12.98, url: "https://www.homedepot.com/s/cabinet%20screws" },
        { label: "Shims", quantity: 3, unit: "pack", price: 4.47 },
        { label: "Thinset mortar", quantity: 2, unit: "bag", price: 18.5 },
        { label: "White sanded grout", quantity: 1, unit: "bag", price: 16.98 },
        { label: "Under-cabinet LED strip", quantity: 4, unit: "", price: 29.97, url: "https://www.homedepot.com/s/under%20cabinet%20led" },
      ],
    });
    // The discussion: the crew and the office, with a photo, a task and a link.
    const c1 = await this.comment(
      kitchenJob,
      this.personId,
      `Cabinets were delivered this morning — <#photo:${progress}>. <@${marcus}> can you start the upper run today?`,
      26,
    );
    await this.comment(kitchenJob, marcus, "On it. Uppers today, base and island tomorrow. We're short 2 boxes of screws — added to the list.", 25, c1);
    await this.comment(
      kitchenJob,
      this.personId,
      `Emma picked the quartz: Calacatta Laza — https://www.msisurfaces.com/quartz-countertops/calacatta-laza-quartz/ . <@${ana}> backsplash is on you next week, see <#task:${checklist}>.`,
      6,
    );
    await this.comment(kitchenJob, ana, `Got it. For reference, here's what it looked like before: <#photo:${before}>`, 4);
    await this.invoice({
      vendorId: cabinets,
      category: "Materials",
      projectId: kitchenJob,
      daysAgo: 14,
      status: "approved",
      payment: "ACH",
      lines: [{ d: "Shaker cabinets, sage green — 18 boxes", a: 9800 }],
    });
    await this.invoice({
      vendorId: homeDepot,
      category: "Materials",
      projectId: kitchenJob,
      daysAgo: 6,
      status: "approved",
      payment: "Visa ••4417",
      lines: [
        { d: "Cabinet screws, shims, construction adhesive", a: 64.82 },
        { d: "Recessed light kits ×6", a: 239.94 },
        { d: "Romex 14/2, 250 ft", a: 89.0 },
        { d: "Sales tax", a: 38.6, tag: "tax" },
      ],
    });
    await this.invoice({
      vendorId: floorDecor,
      category: "Materials",
      projectId: kitchenJob,
      daysAgo: 1,
      status: "pending_review",
      payment: "Visa ••4417",
      lines: [
        { d: "White subway tile 3x6, 32 sq ft", a: 254.4 },
        { d: "Thinset, grout, spacers", a: 71.35 },
        { d: "Sales tax", a: 31.75, tag: "tax" },
      ],
    });
    await this.invoice({
      vendorId: sunbelt,
      category: "Tools & equipment",
      projectId: kitchenJob,
      daysAgo: 4,
      status: "approved",
      payment: "Visa ••4417",
      lines: [{ d: "Wet tile saw — 3-day rental", a: 189 }],
    });

    // ── Bathroom (quoted) ──
    const bathJob = await this.project({
      customerId: chen,
      title: "Primary bathroom refresh",
      typeId: bath,
      address: "907 Russell St, Nashville, TN 37206",
      status: "quoted",
      notes: `Walk-in shower instead of tub, new vanity and fan. Wants it done before her parents visit.`,
      dueIn: 40,
    });
    await this.estimate(bathJob, "sent", "Convert tub to walk-in shower with glass panel; new 48 in vanity, fan and lighting.", [
      { d: "Tub removal and shower pan", q: 1, p: 2200, k: "labor" },
      { d: "Porcelain wall tile, 120 sq ft", q: 120, p: 9.5, k: "material" },
      { d: "Frameless glass panel", q: 1, p: 1350, k: "material" },
      { d: "48 in vanity with quartz top", q: 1, p: 1180, k: "material" },
      { d: "Tile and fixture labor", q: 32, p: 70, k: "labor" },
    ]);
    await this.entry({ projectId: bathJob, day: 3, from: "16:00", to: "16:45", notes: "Review estimate with Linda", lat: 36.1748, lng: -86.7499 });
    await this.photo(bathJob, "bathroom.jpg", "Tile style Linda likes", 5);
    await this.task({ projectId: bathJob, kind: "reminder", title: "Follow up on bathroom estimate", dueIn: 4 });
    await this.comment(bathJob, ana, "Measured the shower wall: 60 × 96 in. 120 sq ft of tile covers it with 10% extra.", 50);

    // ── Café repaint (scheduled) ──
    const cafeJob = await this.project({
      customerId: harbor,
      title: "Café interior repaint",
      typeId: painting,
      address: "310 Harbor St, Nashville, TN 37203",
      status: "scheduled",
      notes: `Dining room and counter area, two coats, low-VOC. Work after closing.`,
      dueIn: 9,
    });
    await this.client.query(`UPDATE projects SET assigned_to = $2 WHERE id = $1`, [cafeJob, jake]);
    await this.estimate(cafeJob, "accepted", "Repaint dining room and counter area (walls and trim), low-VOC paint, evenings.", [
      { d: "Prep, patch and caulk", q: 10, p: 55, k: "labor" },
      { d: "Low-VOC paint, eggshell", q: 9, p: 64, k: "material" },
      { d: "Painting, two coats", q: 28, p: 55, k: "labor" },
    ]);
    const cafe = { lat: 36.1599, lng: -86.7745 };
    await this.entry({ projectId: cafeJob, day: 2, from: "15:30", to: "17:00", notes: "Color samples on the wall", who: jake, ...cafe });
    await this.entry({ projectId: cafeJob, day: 6, from: "15:00", to: "21:00", notes: "Prep and first coat", who: jake, ...cafe });
    await this.entry({ projectId: cafeJob, day: 7, from: "15:00", to: "20:00", notes: "Second coat and trim", who: jake, ...cafe });
    await this.photo(cafeJob, "painting.jpg", "Prep — taped and patched", 2);
    await this.file(cafeJob, "Color schedule.pdf", "Color Schedule — Harbor Street Cafe", [
      "## Walls",
      "Agreeable Gray (SW 7029), eggshell, 2 coats",
      "",
      "## Trim and doors",
      "Pure White (SW 7005), semi-gloss",
      "",
      "## Accent wall behind the counter",
      "Evergreen Fog (SW 9130), eggshell",
    ]);
    await this.task({
      projectId: cafeJob,
      kind: "shopping",
      title: "Paint supplies",
      store: "Sherwin-Williams",
      dueIn: 5,
      who: jake,
      items: [
        { label: "Duration Home, Agreeable Gray", quantity: 6, unit: "gal", price: 68, url: "https://www.sherwin-williams.com/en-us/color/color-family/gray-paint-colors/sw7029-agreeable-gray" },
        { label: "Trim paint, Pure White", quantity: 2, unit: "gal", price: 72 },
        { label: "9 in roller covers", quantity: 6, unit: "", price: 7.49 },
        { label: "Painter's tape", quantity: 4, unit: "roll", price: 6.98 },
      ],
    });
    await this.comment(cafeJob, jake, "Owner wants the accent wall darker — trying Evergreen Fog samples Thursday.", 30);
    await this.invoice({
      vendorId: sherwin,
      category: "Materials",
      projectId: cafeJob,
      daysAgo: 2,
      status: "pending_review",
      payment: "Account",
      dueIn: 28,
      lines: [
        { d: "Duration Home, Agreeable Gray — 6 gal", a: 408 },
        { d: "Pro Classic, Pure White — 2 gal", a: 144 },
        { d: "Sales tax", a: 38.12, tag: "tax" },
      ],
    });

    // ── Deck (lead) and fence (done) ──
    const deckJob = await this.project({
      customerId: parkers,
      title: "Backyard deck stain",
      typeId: deck,
      address: "2418 Belmont Blvd, Nashville, TN 37212",
      status: "lead",
      notes: `Asked about restaining the deck after the kitchen is done.`,
      dueIn: null,
    });
    await this.photo(deckJob, "deck.jpg", "Deck today — weathered, needs stripping", 3);
    await this.task({ projectId: deckJob, kind: "todo", title: "Measure deck and take photos", dueIn: 10, who: marcus });

    const doneJob = await this.project({
      customerId: chen,
      title: "Fence repair",
      typeId: deck,
      address: "907 Russell St, Nashville, TN 37206",
      status: "completed",
      notes: `Replaced 3 rotten posts and 12 pickets. Paid in full.`,
      dueIn: -12,
    });
    await this.estimate(doneJob, "accepted", "Replace 3 fence posts and 12 pickets; stain to match.", [
      { d: "Posts, pickets and concrete", q: 1, p: 340, k: "material" },
      { d: "Labor", q: 8, p: 60, k: "labor" },
    ]);
    await this.invoice({
      vendorId: homeDepot,
      category: "Materials",
      projectId: doneJob,
      daysAgo: 16,
      status: "approved",
      payment: "Visa ••4417",
      lines: [
        { d: "4x4 PT posts ×3, pickets ×12, Quikrete ×4", a: 318.4 },
        { d: "Sales tax", a: 30.25, tag: "tax" },
      ],
    });

    // ── The crew's other week: estimates, a supply run, the shop ──
    await this.entry({ projectId: null, day: 0, from: "16:00", to: "17:00", notes: "Estimate visit — basement finish (new lead)", who: ana, location: "1100 Fatherland St, Nashville, TN", lat: 36.1729, lng: -86.7524 });
    await this.entry({ projectId: null, day: 4, from: "07:00", to: "08:00", notes: "Truck maintenance", who: marcus, location: "Firestone, 2400 West End Ave, Nashville, TN", lat: 36.1488, lng: -86.8079 });
    await this.task({ projectId: null, kind: "todo", title: "Renew contractor license", dueIn: 25, notes: "Tennessee Board for Licensing Contractors — renewal due next month." });

    // ── Running costs ──
    await this.invoice({ vendorId: shell, category: "Fuel & travel", projectId: null, daysAgo: 3, status: "approved", payment: "Fleet card", lines: [{ d: "Diesel, 21.4 gal", a: 78.4 }] });
    await this.invoice({
      vendorId: shell,
      category: "Fuel & travel",
      projectId: null,
      daysAgo: 0,
      status: "flagged",
      payment: "Fleet card",
      lines: [{ d: "Diesel, 26.1 gal + car wash", a: 112.15 }],
      flag: "43% above your usual fill-up",
    });
    await this.invoice({ vendorId: shell, category: "Fuel & travel", projectId: null, daysAgo: 33, status: "approved", payment: "Fleet card", lines: [{ d: "Diesel, 22.8 gal", a: 84.9 }] });
    await this.invoice({
      vendorId: nes,
      category: "Utilities",
      projectId: null,
      daysAgo: 5,
      status: "pending_review",
      payment: "Autopay",
      dueIn: 12,
      lines: [{ d: "Shop electric service — monthly", a: 142.67, tag: "recurring" }],
    });
    await this.invoice({ vendorId: homeDepot, category: "Materials", projectId: null, daysAgo: 36, status: "approved", payment: "Visa ••4417", lines: [{ d: "Shop restock — fasteners, blades, caulk", a: 1240.55 }] });

    await this.budget("Materials", "Materials", 15000);
    await this.budget("Tools & equipment", "Tools & equipment", 800);
    await this.budget("Fuel", "Fuel & travel", 450);
    await this.budget("Utilities", "Utilities", 250);
    return 5;
  }

  /** A week in Lisbon and Porto: the trip as a project, flights, stays and plans on the schedule, photos, documents, receipts. */
  async travel(): Promise<number> {
    const travelType = await this.projectType("Travel", "plane");
    const family = await this.customer({ name: "Family trip", email: null, phone: null, address: null, notes: "Sample travel plan." });
    const tap = await this.vendor("TAP Air Portugal", "Fuel & travel");
    const booking = await this.vendor("Booking.com", "Fuel & travel");

    const start = 21; // three weeks out
    const trip = await this.project({
      customerId: family,
      title: TRAVEL_PROJECT,
      typeId: travelType,
      address: "Lisbon, Portugal",
      status: "scheduled",
      notes: `Seven days: four in Lisbon (day trip to Sintra), train to Porto for three.`,
      dueIn: start + 7,
    });
    await this.entry({ projectId: trip, day: start, from: "18:05", to: "07:20", toDay: start + 1, notes: "Flight BNA → LIS (TP 1520 via EWR)", location: "Nashville International Airport", lat: 36.1263, lng: -86.6774 });
    await this.entry({ projectId: trip, day: start + 1, from: "15:00", to: "11:00", toDay: start + 4, notes: "Hotel — Alfama, 3 nights", location: "Alfama, Lisbon", lat: 38.7118, lng: -9.1301 });
    await this.entry({ projectId: trip, day: start + 2, from: "09:30", to: "17:30", notes: "Day trip to Sintra — Pena Palace (tickets for 10:00)", location: "Pena Palace, Sintra", lat: 38.7876, lng: -9.3906 });
    await this.entry({ projectId: trip, day: start + 3, from: "19:30", to: "21:30", notes: "Fado dinner", location: "Clube de Fado, Lisbon", lat: 38.7105, lng: -9.1297 });
    await this.entry({ projectId: trip, day: start + 4, from: "11:39", to: "14:28", notes: "Train Lisbon → Porto (Alfa Pendular)", location: "Santa Apolónia station, Lisbon", lat: 38.7137, lng: -9.1225 });
    await this.entry({ projectId: trip, day: start + 4, from: "15:00", to: "10:00", toDay: start + 7, notes: "Apartment — Ribeira, 3 nights", location: "Ribeira, Porto", lat: 41.1406, lng: -8.6132 });
    await this.entry({ projectId: trip, day: start + 5, from: "15:00", to: "16:30", notes: "Port wine cellar tour", location: "Vila Nova de Gaia", lat: 41.1366, lng: -8.6131 });
    await this.entry({ projectId: trip, day: start + 7, from: "12:40", to: "19:55", notes: "Flight OPO → BNA", location: "Porto Airport", lat: 41.2481, lng: -8.6814 });
    const lisbon = await this.photo(trip, "lisbon.jpg", "Lisbon — a tram in the old town", 12);
    await this.photo(trip, "sintra.jpg", "Pena Palace, Sintra", 12);
    await this.photo(trip, "porto.jpg", "Porto — Ribeira and the Dom Luís I bridge", 12);
    await this.file(trip, "Flight itinerary.pdf", "Flight Itinerary (sample)", [
      "Booking reference: TPX4K2",
      "",
      "## Outbound",
      `TP 1520  Nashville (BNA) 18:05 -> Newark (EWR) 21:10`,
      `TP 202   Newark (EWR) 22:45 -> Lisbon (LIS) 10:20 +1`,
      "",
      "## Return",
      `TP 1945  Porto (OPO) 12:40 -> Newark (EWR) 15:30`,
      `UA 2178  Newark (EWR) 17:35 -> Nashville (BNA) 19:55`,
      "",
      "Checked bags: 1 per person. Online check-in opens 36 hours before departure.",
    ], ["travel"]);
    await this.file(trip, "Hotel confirmation.pdf", "Hotel Confirmation (sample)", [
      "Casa do Alfama — 3 nights",
      "Check-in 15:00, check-out 11:00",
      "Room: Double with river view, breakfast included",
      "",
      "Free cancellation until 7 days before arrival.",
    ], ["travel"]);
    await this.task({
      projectId: trip,
      kind: "todo",
      title: "Before the trip",
      dueIn: start - 1,
      items: [
        { label: "Check passports (valid 6+ months)", done: true },
        { label: "Book Pena Palace tickets", done: true, url: "https://www.parquesdesintra.pt/en/" },
        { label: "Book Lisbon → Porto train", url: "https://www.cp.pt/passageiros/en" },
        { label: "Tell the bank about travel dates" },
        { label: "Download offline maps" },
        { label: "Arrange pet sitter" },
      ],
    });
    await this.task({
      projectId: trip,
      kind: "shopping",
      title: "Packing list",
      dueIn: start - 1,
      items: [
        { label: "Comfortable walking shoes" },
        { label: "Travel adapters (type F)", quantity: 2, unit: "" },
        { label: "Light rain jacket" },
        { label: "Sunscreen" },
        { label: "Reusable water bottles", quantity: 2, unit: "" },
      ],
    });
    await this.task({ projectId: trip, kind: "reminder", title: "Online check-in opens", dueIn: start - 1 });
    await this.comment(
      trip,
      this.personId,
      `Tram 28 gets packed by 10am — let's ride it early on day 2 (<#photo:${lisbon}>). Time Out has a good food guide: https://www.timeout.com/lisbon/restaurants/best-restaurants-in-lisbon`,
      40,
    );
    await this.invoice({
      vendorId: tap,
      category: "Fuel & travel",
      projectId: trip,
      daysAgo: 10,
      status: "approved",
      payment: "Visa ••4417",
      lines: [
        { d: "2 round-trip tickets BNA–LIS / OPO–BNA", a: 1384.2 },
        { d: "Taxes and carrier fees", a: 102, tag: "tax" },
      ],
    });
    await this.invoice({
      vendorId: booking,
      category: "Fuel & travel",
      projectId: trip,
      daysAgo: 9,
      status: "approved",
      payment: "Visa ••4417",
      lines: [{ d: "Casa do Alfama — 3 nights (prepaid)", a: 612 }],
    });
    return 1;
  }
}
