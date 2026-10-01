import { NextResponse } from "next/server";
import { api, apiSession } from "@/lib/api";
import { listProjects, projectOverview } from "@/lib/projects";
import { needsAttention, overviewStats, recentInvoices, spendByCategory } from "@/lib/queries";

/** GET → the Overview: project and spending stats, spend by category, needs-attention, active jobs, recent invoices. */
export const GET = api(async () => {
  const { org } = await apiSession();
  const [projects, finance, spend, attention, all, invoices] = await Promise.all([
    projectOverview(org.id),
    overviewStats(org.id),
    spendByCategory(org.id),
    needsAttention(org.id),
    listProjects(org.id),
    recentInvoices(org.id, 5),
  ]);
  // Jobs underway, soonest due first — like the web's Active projects widget.
  const active = all
    .filter((p) => p.status === "scheduled" || p.status === "in_progress")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 4);
  return NextResponse.json({
    projects,
    finance,
    spend: spend.filter((s) => s.total > 0),
    attention,
    active,
    recentInvoices: invoices,
  });
});
