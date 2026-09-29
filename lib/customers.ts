/**
 * Customers: the contact a job is done for. Every read/write here is scoped
 * to one org — see lib/auth.ts.
 */
import { query, queryOne } from "@/lib/db";

export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string;
  jobCount: number;
  createdAt: Date;
};

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string;
  job_count: string;
  created_at: Date;
};

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    jobCount: Number(row.job_count),
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT c.id, c.name, c.email, c.phone, c.address, c.notes, c.created_at,
       (SELECT count(*) FROM jobs j WHERE j.customer_id = c.id)::text AS job_count
  FROM customers c`;

export async function listCustomers(orgId: string, search?: string): Promise<Customer[]> {
  const term = search?.trim();
  const rows = await query<CustomerRow>(
    term
      ? `${SELECT} WHERE c.org_id = $1 AND (c.name ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2)
          ORDER BY c.name`
      : `${SELECT} WHERE c.org_id = $1 ORDER BY c.name`,
    term ? [orgId, `%${term}%`] : [orgId],
  );
  return rows.map(toCustomer);
}

export async function getCustomer(id: string, orgId: string): Promise<Customer | null> {
  const row = await queryOne<CustomerRow>(`${SELECT} WHERE c.id = $1 AND c.org_id = $2`, [id, orgId]);
  return row ? toCustomer(row) : null;
}

export async function createCustomer(input: {
  orgId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO customers (org_id, name, email, phone, address, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.orgId, input.name, input.email, input.phone, input.address, input.notes],
  );
  return row!.id;
}

export async function updateCustomer(
  id: string,
  orgId: string,
  input: { name: string; email: string | null; phone: string | null; address: string | null; notes: string },
): Promise<void> {
  await query(
    `UPDATE customers SET name = $3, email = $4, phone = $5, address = $6, notes = $7
      WHERE id = $1 AND org_id = $2`,
    [id, orgId, input.name, input.email, input.phone, input.address, input.notes],
  );
}

export async function deleteCustomer(id: string, orgId: string): Promise<void> {
  await query(`DELETE FROM customers WHERE id = $1 AND org_id = $2`, [id, orgId]);
}
