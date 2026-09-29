"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import type { LineItemKind } from "@/lib/quoting";
import { saveEstimate } from "./actions";

export type DraftLine = { description: string; quantity: number; unitPrice: number; kind: LineItemKind };

const inputClass =
  "rounded-[10px] border border-line bg-surface px-2 py-[6px] text-[12px] text-ink outline-none focus:border-[#9aa78a]";

function total(lines: DraftLine[]) {
  return lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
}

/**
 * The line-item editor for an estimate: summary, lines (description / kind /
 * qty × price), running total, Save and Cancel. Creates a new estimate, or
 * with `estimateId` updates that draft. `onDone` runs after a successful save
 * or on Cancel.
 */
export function EstimateEditor({
  projectId,
  estimateId,
  heading,
  initialSummary,
  initialLines,
  aiGenerated = false,
  onDone,
}: {
  projectId: string;
  estimateId?: string;
  heading: string;
  initialSummary: string;
  initialLines: DraftLine[];
  aiGenerated?: boolean;
  onDone: () => void;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [lines, setLines] = useState<DraftLine[]>(initialLines);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const updateLine = (i: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  // Close the editor only once the save has gone through — so a failure leaves the edits on screen.
  function save() {
    const form = new FormData();
    form.set("projectId", projectId);
    if (estimateId) form.set("estimateId", estimateId);
    form.set("summary", summary);
    form.set("lineItems", JSON.stringify(lines));
    form.set("aiGenerated", String(aiGenerated));
    setError(null);
    startSaving(async () => {
      const result = await saveEstimate(form);
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="flex flex-col gap-[10px] rounded-[14px] border border-line bg-surface p-[13px]">
      <div className="flex items-center gap-[8px]">
        <span className="text-[12px] font-semibold">{heading}</span>
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="ml-auto cursor-pointer text-[11.5px] font-medium underline"
        >
          {estimateId ? "Cancel" : "Discard"}
        </button>
      </div>
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        placeholder="Scope summary the customer will read"
        className={`${inputClass} w-full`}
      />
      <div className="flex flex-col gap-[6px]">
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-center gap-[6px]">
            <input
              value={line.description}
              onChange={(e) => updateLine(i, { description: e.target.value })}
              placeholder="Description"
              className={`${inputClass} min-w-[160px] flex-1`}
            />
            <select
              value={line.kind}
              onChange={(e) => updateLine(i, { kind: e.target.value as LineItemKind })}
              className={inputClass}
            >
              <option value="labor">Labor</option>
              <option value="material">Material</option>
              <option value="other">Other</option>
            </select>
            <input
              type="number"
              min={0}
              step="0.5"
              value={line.quantity}
              onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
              aria-label="Quantity"
              className={`${inputClass} w-[64px]`}
            />
            <span className="text-[11px] text-faint">×$</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={line.unitPrice}
              onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
              aria-label="Unit price"
              className={`${inputClass} w-[80px]`}
            />
            <button
              type="button"
              onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
              className="cursor-pointer text-faint hover:text-bad-fg"
              aria-label="Remove line"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0, kind: "labor" }])}
          className="w-fit cursor-pointer text-[11.5px] font-medium underline"
        >
          + Add line
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-[10px] border-t border-line-soft pt-[9px]">
        <span className="text-[13px] font-semibold">Total: ${total(lines).toFixed(2)}</span>
        {error ? <span className="text-[11.5px] text-bad-fg">{error}</span> : null}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="ml-auto cursor-pointer rounded-full bg-ink px-4 py-[8px] text-[12px] font-semibold text-bg disabled:opacity-50"
        >
          {saving ? "Saving…" : estimateId ? "Save changes" : "Save as estimate"}
        </button>
      </div>
    </div>
  );
}
