"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Icon } from "@/components/icons";
import { ModalDialog } from "@/components/modal-dialog";
import { addSampleData, removeSampleData } from "@/app/(dashboard)/sample-data-actions";

const SETS = [
  { id: "renovation", label: "Renovation jobs", detail: "5 projects with estimates, site visits and job tasks", icon: "wrench" },
  { id: "travel", label: "Travel plan", detail: "A week in Lisbon & Porto: flights, stays, packing list", icon: "plane" },
] as const;

const DISMISSED_KEY = "clandar.sampleDataOffer.dismissed";
const subscribe = () => () => {};

/**
 * A new, empty workspace's offer: explore with sample data (renovation jobs and/or a travel plan), or
 * start fresh. `dismissible` (Overview) adds "Start fresh", remembered in this browser.
 */
export function SampleDataOffer({ dismissible = true }: { dismissible?: boolean }) {
  const dismissedStored = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(DISMISSED_KEY) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);
  const [chosen, setChosen] = useState<string[]>(["renovation", "travel"]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (dismissible && (dismissed || dismissedStored)) return null;

  if (pending) {
    return (
      <div className="flex justify-center py-[40px]">
        <div className="flex items-center gap-[10px] rounded-full bg-lime px-[26px] py-[14px] text-[14px] font-semibold text-ink shadow-[0_10px_40px_rgba(196,230,90,0.45)]">
          <Icon name="refresh" size={16} className="animate-spin" />
          Cooking up your demo…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[14px] rounded-[20px] border border-line bg-surface p-[20px]">
      <div className="flex flex-col gap-[4px]">
        <span className="text-[16px] font-semibold">New here? Explore with sample data</span>
        <span className="text-[12.5px] text-muted">
          See how Clandar works with a few ready-made projects. Remove them in one tap whenever you&apos;re ready to start
          for real — your own data is never touched.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
        {SETS.map((set) => {
          const on = chosen.includes(set.id);
          return (
            <button
              key={set.id}
              type="button"
              aria-pressed={on}
              onClick={() => setChosen((c) => (on ? c.filter((x) => x !== set.id) : [...c, set.id]))}
              className={`flex cursor-pointer items-center gap-[12px] rounded-[14px] border px-[14px] py-[12px] text-left ${
                on ? "border-ink bg-bg" : "border-line bg-surface"
              }`}
            >
              <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-lime text-ink">
                <Icon name={set.icon} size={16} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-semibold">{set.label}</span>
                <span className="text-[11.5px] text-muted">{set.detail}</span>
              </span>
              <span
                className={`flex size-[20px] shrink-0 items-center justify-center rounded-full border ${on ? "border-ink bg-ink text-bg" : "border-line"}`}
              >
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {error ? <span className="text-[12px] text-bad-fg">{error}</span> : null}
      <div className="flex flex-wrap items-center gap-[10px]">
        <button
          type="button"
          disabled={chosen.length === 0}
          onClick={() =>
            startTransition(async () => {
              const result = await addSampleData(chosen, Intl.DateTimeFormat().resolvedOptions().timeZone);
              setError(result.error ?? null);
            })
          }
          className="cursor-pointer rounded-full bg-ink px-[18px] py-[10px] text-[13px] font-semibold text-bg disabled:cursor-default disabled:opacity-50"
        >
          Add sample data
        </button>
        {dismissible ? (
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem(DISMISSED_KEY, "1");
              } catch {}
            }}
            className="cursor-pointer text-[13px] font-medium text-muted underline"
          >
            Start fresh
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** While sample data is in the workspace: a banner to remove it — nudged once they've added their own. */
export function SampleDataBanner({ hasOwnData }: { hasOwnData: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] rounded-[14px] bg-lime/40 px-[14px] py-[10px] text-[12.5px]">
      <Icon name="star" size={14} />
      <span className="min-w-0 flex-1">
        {hasOwnData
          ? "You've added your own work — ready to remove the sample data?"
          : "You're exploring with sample data."}
      </span>
      <RemoveSampleDataButton />
    </div>
  );
}

/** "Remove sample data", with a confirmation. */
export function RemoveSampleDataButton({ label = "Remove sample data" }: { label?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <ModalDialog
      title="Remove sample data?"
      trigger={(open) => (
        <button type="button" onClick={open} disabled={pending} className="cursor-pointer font-semibold underline disabled:opacity-50">
          {pending ? "Removing…" : label}
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-[14px] text-[13px]">
          <p className="m-0 text-body-soft">
            The sample customers, projects, schedule and tasks are deleted. Anything you added yourself stays — your own tasks
            or visits on a sample project are kept and just unlinked from it.
          </p>
          <div className="flex justify-end gap-[10px]">
            <button type="button" onClick={close} className="cursor-pointer rounded-full border border-line px-[16px] py-[8px] font-medium">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                close();
                startTransition(() => removeSampleData());
              }}
              className="cursor-pointer rounded-full bg-bad-fg px-[16px] py-[8px] font-semibold text-white"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
