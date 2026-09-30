"use client";

/**
 * Opens the Aide chat panel (see components/app-shell.tsx) without needing a route to link
 * to. With `prompt`, the assistant also asks it straight away, in a fresh conversation.
 */
export function OpenAideButton({
  children,
  className,
  prompt,
}: {
  children: React.ReactNode;
  className?: string;
  prompt?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("clandar:open-aide", { detail: { prompt } }))}
      className={className}
    >
      {children}
    </button>
  );
}
