"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icons";
import type { LineItemKind } from "@/lib/quoting";
import { analyzePhotos, saveEstimate, type AnalyzeState } from "./actions";

type DraftLine = { description: string; quantity: number; unitPrice: number; kind: LineItemKind };

const inputClass =
  "rounded-[10px] border border-line bg-surface px-2 py-[6px] text-[12px] text-ink outline-none focus:border-[#9aa78a]";

function total(lines: DraftLine[]) {
  return lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
}

export function EstimateBuilder({ jobId, photoCount }: { jobId: string; photoCount: number }) {
  const [state, action, pending] = useActionState<AnalyzeState, FormData>(analyzePhotos, {});
  const [summary, setSummary] = useState("");
  const [lines, setLines] = useState<DraftLine[] | null>(null);

  // A fresh proposal replaces whatever draft was on screen — adjusting state
  // during render rather than an effect, since the proposal itself is the prop.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.proposal) {
      setSummary(state.proposal.summary);
      setLines(state.proposal.lineItems.map((l) => ({ ...l })));
    }
  }

  const updateLine = (i: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev?.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) ?? prev);
  };

  return (
    <div className="flex flex-col gap-[12px]">
      {lines === null ? (
        <form action={action} className="flex items-center gap-[10px]">
          <input type="hidden" name="jobId" value={jobId} />
          <button
            type="submit"
            disabled={pending || photoCount === 0}
            title={photoCount === 0 ? "Upload at least one photo first" : undefined}
            className="flex items-center gap-[7px] rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-40"
          >
            <Icon name="camera" size={15} />
            {pending ? "Analyzing photos…" : "Analyze photos with AI"}
          </button>
          {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
        </form>
      ) : (
        <div className="flex flex-col gap-[10px] rounded-[14px] border border-line bg-surface p-[13px]">
          <div className="flex items-center gap-[8px]">
            <span className="text-[12px] font-semibold">AI-proposed estimate — review before saving</span>
            <button
              type="button"
              onClick={() => setLines(null)}
              className="ml-auto cursor-pointer text-[11.5px] font-medium underline"
            >
              Discard
            </button>
          </div>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            className={`${inputClass} w-full`}
          />
          <div className="flex flex-col gap-[6px]">
            {lines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-center gap-[6px]">
                <input
                  value={line.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
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
                  className={`${inputClass} w-[64px]`}
                />
                <span className="text-[11px] text-faint">×$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
                  className={`${inputClass} w-[80px]`}
                />
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev?.filter((_, idx) => idx !== i) ?? prev)}
                  className="cursor-pointer text-faint hover:text-bad-fg"
                  aria-label="Remove line"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setLines((prev) => [...(prev ?? []), { description: "", quantity: 1, unitPrice: 0, kind: "labor" }])
              }
              className="w-fit cursor-pointer text-[11.5px] font-medium underline"
            >
              + Add line
            </button>
          </div>
          <div className="flex items-center gap-[10px] border-t border-line-soft pt-[9px]">
            <span className="text-[13px] font-semibold">Total: ${total(lines).toFixed(2)}</span>
            <form action={saveEstimate} className="ml-auto">
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="summary" value={summary} />
              <input type="hidden" name="lineItems" value={JSON.stringify(lines)} />
              <input type="hidden" name="aiGenerated" value="true" />
              <button
                type="submit"
                onClick={() => setLines(null)}
                className="cursor-pointer rounded-full bg-ink px-4 py-[8px] text-[12px] font-semibold text-bg"
              >
                Save as estimate
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
