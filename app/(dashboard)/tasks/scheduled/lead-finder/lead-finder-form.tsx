"use client";

import { useActionState } from "react";
import { TimeZoneField } from "@/components/time-zone-field";
import type { LeadFinderSettings } from "@/lib/lead-finder";
import { saveLeadFinder, scanLeadsNow, type LeadFormState } from "../../../email/lead-actions";

const inputClass =
  "rounded-[10px] border border-line bg-surface px-[10px] py-[8px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

const STRICTNESS = [
  { value: "0.5", label: "Relaxed — catch anything that might be a job" },
  { value: "0.65", label: "Balanced (recommended)" },
  { value: "0.8", label: "Strict — only clear requests for work" },
];

function Toggle({ name, defaultChecked, label, hint }: { name: string; defaultChecked: boolean; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-[10px]">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-[2px] size-[16px] accent-[#101211]" />
      <span className="flex flex-col gap-[1px]">
        <span className="text-[13px] font-medium">{label}</span>
        {hint ? <span className="text-[11.5px] text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** The lead finder's settings, plus "Scan now". */
export function LeadFinderForm({ settings }: { settings: LeadFinderSettings }) {
  const [state, action, pending] = useActionState<LeadFormState, FormData>(saveLeadFinder, {});
  const [scan, scanAction, scanning] = useActionState<LeadFormState>(scanLeadsNow, {});
  const strictness = STRICTNESS.reduce((best, s) =>
    Math.abs(Number(s.value) - settings.minConfidence) < Math.abs(Number(best.value) - settings.minConfidence) ? s : best,
  ).value;

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Keyed by the saved values so the selects don't snap back after saving (React resets action forms). */}
      <form
        key={JSON.stringify(settings)}
        action={action}
        className="flex flex-col gap-[16px]"
      >
        <TimeZoneField />
        <Toggle
          name="isEnabled"
          defaultChecked={settings.isEnabled}
          label="Watch my email for project opportunities"
          hint="New inbox mail is checked by your email AI; promotions, social and forum tabs are skipped."
        />

        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] text-muted">Check for new email</span>
            <select name="checkMinutes" defaultValue={String(settings.checkMinutes)} className={inputClass}>
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every hour</option>
            </select>
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] text-muted">How strict</span>
            <select name="minConfidence" defaultValue={strictness} className={inputClass}>
              {STRICTNESS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-[5px]">
          <span className="text-[11.5px] text-muted">Your rules (optional)</span>
          <textarea
            name="instructions"
            rows={3}
            defaultValue={settings.instructions}
            placeholder="e.g. I only work in Brooklyn and Queens. Skip commercial jobs and anything under $500."
            className={inputClass}
          />
        </label>

        <Toggle
          name="gmailLabels"
          defaultChecked={settings.gmailLabels}
          label="Label leads in Gmail too"
          hint="Adds “Leads/<project type>” labels, so they're tagged in the Gmail app on your phone."
        />

        <fieldset className="flex flex-col gap-[10px] rounded-[14px] border border-line p-[14px]">
          <legend className="px-[4px] text-[12.5px] font-semibold">Daily digest</legend>
          <Toggle
            name="digestEnabled"
            defaultChecked={settings.digestEnabled}
            label="Send me a summary of new leads every day"
            hint="Skipped on days with no new leads."
          />
          <label className="flex items-center gap-[8px] text-[12.5px]">
            <span className="text-muted">At</span>
            <input type="time" name="digestTime" defaultValue={settings.digestTime} className={inputClass} />
          </label>
          <div className="flex flex-wrap gap-x-[18px] gap-y-[8px]">
            <Toggle name="digestBell" defaultChecked={settings.digestBell} label="Bell" />
            <Toggle name="digestPush" defaultChecked={settings.digestPush} label="Browser push" />
            <Toggle name="digestEmail" defaultChecked={settings.digestEmail} label="Email" />
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-[10px]">
          <button
            type="submit"
            disabled={pending}
            className="cursor-pointer rounded-full bg-ink px-5 py-[9px] text-[12.5px] font-semibold text-bg disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {state.error ? <span className="text-[12px] text-bad-fg">{state.error}</span> : null}
          {state.ok && !pending ? <span className="text-[12px] text-ok-fg">{state.ok}</span> : null}
        </div>
      </form>

      <form action={scanAction} className="flex flex-wrap items-center gap-[10px] border-t border-line-soft pt-[14px]">
        <button
          type="submit"
          disabled={scanning}
          className="cursor-pointer rounded-full border border-line px-4 py-[8px] text-[12.5px] font-medium disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "Scan now"}
        </button>
        <span className={`text-[12px] ${scan.error ? "text-bad-fg" : "text-muted"}`}>
          {scanning
            ? "Reading new mail and asking your email AI — this can take a minute."
            : (scan.error ?? scan.ok ?? "Checks new mail right away instead of waiting for the next scan.")}
        </span>
      </form>
    </div>
  );
}
