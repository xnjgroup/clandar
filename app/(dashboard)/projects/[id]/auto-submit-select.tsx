"use client";

import type { ReactNode } from "react";

/** A <select> that submits its enclosing form the moment its value changes — for one-field status/assignee pickers. */
export function AutoSubmitSelect({
  name,
  defaultValue,
  className,
  children,
}: {
  name: string;
  defaultValue: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <select
      // Remount when the saved value changes: the form resets after its action submits, and a
      // <select> resets to the option it was first rendered with — this keeps it on the new value.
      key={defaultValue}
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={className}
    >
      {children}
    </select>
  );
}
