"use server";

import { requireSession } from "@/lib/auth";
import { saveDashboardLayout, type Placement } from "@/lib/dashboard-layout";

/** Saves the signed-in person's overview arrangement (called by the dashboard grid after a move/resize). */
export async function saveOverviewLayout(layout: Placement[]): Promise<void> {
  const { person } = await requireSession();
  await saveDashboardLayout(person.id, "overview", layout);
}
