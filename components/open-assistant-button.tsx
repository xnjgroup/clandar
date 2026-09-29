"use client";

/** Opens the Executive Assistant panel (see components/app-shell.tsx) without needing a route to link to. */
export function OpenAssistantButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("clandar:open-assistant"))}
      className={className}
    >
      {children}
    </button>
  );
}
