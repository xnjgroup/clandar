"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { originFromHeaders } from "@/lib/request-origin";
import { requireSession } from "@/lib/auth";
import { addDemoData, DEMO_SETS, removeDemoData, type DemoSet } from "@/lib/demo-data";

/** Adds the chosen sample sets (Overview's offer, Settings → Sample data). */
export async function addSampleData(sets: string[], timeZone: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const chosen = sets.filter((s): s is DemoSet => DEMO_SETS.some((d) => d.id === s));
  if (chosen.length === 0) return { error: "Pick at least one." };
  try {
    await addDemoData(session.org.id, session.person.id, chosen, timeZone, originFromHeaders(await headers()));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't add the sample data." };
  }
  revalidatePath("/", "layout");
  return {};
}

/** Removes all sample data — the person's own records stay. */
export async function removeSampleData(): Promise<void> {
  const { org } = await requireSession();
  await removeDemoData(org.id);
  revalidatePath("/", "layout");
}
