"use client";

import { useState, type ReactNode } from "react";
import { EstimateEditor, type DraftLine } from "./estimate-editor";

/**
 * A saved estimate on the project page: shows its server-rendered read view
 * (`children`), plus — while it's still a draft — an Edit button that swaps in
 * the line editor prefilled with what's saved. A sent/answered estimate stays
 * as the customer saw it; "Revise" copies it into a new draft instead.
 */
export function EditableEstimate({
  projectId,
  estimateId,
  isDraft,
  summary,
  lines,
  children,
}: {
  projectId: string;
  estimateId: string;
  isDraft: boolean;
  summary: string;
  lines: DraftLine[];
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EstimateEditor
        projectId={projectId}
        // Revising a sent one saves a new estimate (no id); the original is left untouched.
        estimateId={isDraft ? estimateId : undefined}
        heading={isDraft ? "Edit estimate" : "Revise — saves as a new draft; the sent one stays as it was"}
        initialSummary={summary}
        initialLines={lines}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <>
      {children}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-fit cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium"
      >
        {isDraft ? "Edit" : "Revise"}
      </button>
    </>
  );
}
