"use client";

import { useState } from "react";
import { CardTitle } from "@/components/ui";
import { NewScheduledTaskForm } from "./new-scheduled-task-form";

export function AddScheduledTaskButton() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-[10px]">
        <CardTitle>New task</CardTitle>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto shrink-0 cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg"
        >
          + Custom task
        </button>
      </div>
    );
  }

  return <NewScheduledTaskForm onCancel={() => setOpen(false)} />;
}
