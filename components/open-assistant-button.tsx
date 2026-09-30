"use client";

/**
 * Opens the assistant's chat panel (see components/app-shell.tsx) without needing a route to link
 * to. With `prompt`, the assistant also asks it straight away, in a fresh conversation.
 */
export function OpenAssistantButton({
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
      onClick={() => window.dispatchEvent(new CustomEvent("clandar:open-assistant", { detail: { prompt } }))}
      className={className}
    >
      {children}
    </button>
  );
}
