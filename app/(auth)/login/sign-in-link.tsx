"use client";

import type { ReactNode } from "react";

/** Jumps to the sign-in card and puts the cursor in its email box (when email sign-in is on). */
export function SignInLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <a
      href="#signin"
      className={className}
      onClick={(e) => {
        const card = document.getElementById("signin");
        const email = document.getElementById("login-email") as HTMLInputElement | null;
        if (!card) return;
        e.preventDefault();
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#signin");
        // preventScroll: the smooth scroll above is already on its way there.
        email?.focus({ preventScroll: true });
      }}
    >
      {children}
    </a>
  );
}
