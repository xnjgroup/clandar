import { NextResponse } from "next/server";
import { api, apiSession } from "@/lib/api";
import { INVOICE_STATUS_TABS, listInvoices, type InvoiceStatusTab } from "@/lib/queries";

/** GET ?tab=All|Flagged|Pending|Approved&q=&page= → { rows, total, tabs } (30 a page). */
export const GET = api(async (request: Request) => {
  const { org } = await apiSession();
  const params = new URL(request.url).searchParams;
  const tab = (INVOICE_STATUS_TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as InvoiceStatusTab) : "All";
  // The app's pages start at 1; listInvoices counts from 0.
  const page = Math.max(1, Number(params.get("page")) || 1);
  const { rows, total } = await listInvoices(org.id, { tab, search: params.get("q")?.trim() ?? "", page: page - 1, size: 30 });
  return NextResponse.json({ rows, total, tabs: INVOICE_STATUS_TABS });
});
