import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { automationSchedule } from "@/lib/api-automations";
import { createScheduledTask, listScheduledTasks, TASK_PRESETS } from "@/lib/scheduled-tasks";

/** GET → { automations, presets } — the org's automations and the ready-made ones to add. */
export const GET = api(async () => {
  const { org } = await apiSession();
  return NextResponse.json({ automations: await listScheduledTasks(org.id), presets: TASK_PRESETS });
});

/**
 * POST { preset: index } or { name, prompt, description? } — plus the schedule
 * { frequency: daily|weekdays|weekly, runTime: "HH:MM", runWeekday?, timeZone } → { id }.
 */
export const POST = api(async (request: Request) => {
  const { org, person } = await apiSession();
  const body = await jsonBody<{
    preset?: number;
    name?: string;
    prompt?: string;
    description?: string;
    frequency?: string;
    runTime?: string;
    runWeekday?: number | null;
    timeZone?: string;
  }>(request);
  const preset = typeof body.preset === "number" ? TASK_PRESETS[body.preset] : undefined;
  if (typeof body.preset === "number" && !preset) throw new ApiError(400, "Unknown preset.");
  const name = preset?.name ?? body.name?.trim();
  const prompt = preset?.prompt ?? body.prompt?.trim();
  if (!name) throw new ApiError(400, "Give the automation a name.");
  if (!prompt) throw new ApiError(400, "Describe what it should do.");
  const schedule = automationSchedule({
    frequency: body.frequency ?? preset?.frequency,
    runTime: body.runTime ?? preset?.runTime,
    runWeekday: body.runWeekday ?? preset?.runWeekday,
    timeZone: body.timeZone,
  });
  const id = await createScheduledTask({
    orgId: org.id,
    name,
    description: preset?.description ?? body.description?.trim() ?? "",
    icon: preset?.icon ?? "bot",
    prompt,
    ...schedule,
    createdBy: person.id,
  });
  return NextResponse.json({ id }, { status: 201 });
});
