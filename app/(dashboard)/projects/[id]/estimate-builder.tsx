"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icons";
import { analyzePhotos, type AnalyzeState } from "./actions";
import { EstimateEditor, type DraftLine } from "./estimate-editor";

type Draft = { summary: string; lines: DraftLine[]; aiGenerated: boolean };

/** Starts a new estimate — drafted by AI from the project's photos, or blank to write by hand — in the shared line editor. */
export function EstimateBuilder({ projectId, photoCount }: { projectId: string; photoCount: number }) {
  const [state, action, pending] = useActionState<AnalyzeState, FormData>(analyzePhotos, {});
  const [draft, setDraft] = useState<Draft | null>(null);
  // Each draft gets a fresh editor instance, so its state starts from that draft.
  const [draftKey, setDraftKey] = useState(0);

  // A fresh proposal replaces whatever draft was on screen — adjusting state
  // during render rather than an effect, since the proposal itself is the prop.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.proposal) {
      setDraft({
        summary: state.proposal.summary,
        lines: state.proposal.lineItems.map((l) => ({ ...l })),
        aiGenerated: true,
      });
      setDraftKey((k) => k + 1);
    }
  }

  if (draft) {
    return (
      <EstimateEditor
        key={draftKey}
        projectId={projectId}
        heading={draft.aiGenerated ? "AI-proposed estimate — review before saving" : "New estimate"}
        initialSummary={draft.summary}
        initialLines={draft.lines}
        aiGenerated={draft.aiGenerated}
        onDone={() => setDraft(null)}
      />
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-[10px]">
      <input type="hidden" name="projectId" value={projectId} />
      <button
        type="submit"
        disabled={pending || photoCount === 0}
        title={photoCount === 0 ? "Upload at least one photo first" : undefined}
        className="flex items-center gap-[7px] rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-40"
      >
        <Icon name="camera" size={15} />
        {pending ? "Analyzing photos…" : "Analyze photos with AI"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setDraft({ summary: "", lines: [{ description: "", quantity: 1, unitPrice: 0, kind: "labor" }], aiGenerated: false });
          setDraftKey((k) => k + 1);
        }}
        className="cursor-pointer rounded-full border border-line px-4 py-[9px] text-[12.5px] font-medium disabled:opacity-40"
      >
        Write one by hand
      </button>
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
    </form>
  );
}
