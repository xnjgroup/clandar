/** Task kinds and reminder repeats — kept free of DB imports so client components can use them too. */
export type TaskKind = "todo" | "shopping" | "reminder";

export const TASK_KINDS: { id: TaskKind; label: string }[] = [
  { id: "todo", label: "To-do" },
  { id: "shopping", label: "Shopping list" },
  { id: "reminder", label: "Reminder" },
];

export type Repeat = "none" | "daily" | "weekly" | "monthly" | "yearly";

export const REPEATS: { id: Repeat; label: string }[] = [
  { id: "none", label: "Doesn't repeat" },
  { id: "daily", label: "Every day" },
  { id: "weekly", label: "Every week" },
  { id: "monthly", label: "Every month" },
  { id: "yearly", label: "Every year" },
];
