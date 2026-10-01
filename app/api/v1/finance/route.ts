import { NextResponse } from "next/server";
import { api, apiSession } from "@/lib/api";
import {
  budgetUsage,
  categorySpend,
  fraudStats,
  listApprovals,
  monthlySpend,
  openFraudFlags,
  overviewStats,
  recurringCharges,
  recurringStats,
} from "@/lib/queries";

/**
 * GET → the finance module in one go: headline stats, expenses (by category, last 6 months),
 * recurring charges, budgets, open fraud flags, and the approval queue (pending / approved / rejected).
 */
export const GET = api(async () => {
  const { org } = await apiSession();
  const [stats, categories, months, recurring, recurringSummary, budgets, fraud, fraudSummary, pending, approved, rejected] =
    await Promise.all([
      overviewStats(org.id),
      categorySpend(org.id),
      monthlySpend(org.id, 6),
      recurringCharges(org.id),
      recurringStats(org.id),
      budgetUsage(org.id),
      openFraudFlags(org.id),
      fraudStats(org.id),
      listApprovals(org.id, "Pending"),
      listApprovals(org.id, "Approved", 20),
      listApprovals(org.id, "Rejected", 20),
    ]);
  return NextResponse.json({
    stats,
    expenses: { categories, months },
    recurring: { summary: recurringSummary, charges: recurring },
    budgets,
    fraud: { summary: fraudSummary, flags: fraud },
    approvals: { pending, approved, rejected },
  });
});
