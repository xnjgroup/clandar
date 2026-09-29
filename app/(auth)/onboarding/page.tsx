import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace — Clandar" };

export default async function OnboardingPage() {
  const { org, person } = await requireSession();
  if (org.onboarded || person.role !== "owner") redirect("/overview");

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-[380px] flex-col items-center gap-6 rounded-[20px] border border-line bg-surface px-8 py-10 text-center">
        <div className="flex flex-col items-center gap-2">
          <span className="flex size-[46px] items-center justify-center rounded-[14px] bg-ink text-[20px] font-bold text-lime">
            C.
          </span>
          <h1 className="m-0 text-[20px] font-bold tracking-[-0.02em]">Welcome to Clandar</h1>
          <p className="m-0 text-[13px] leading-[1.55] text-muted">
            What&rsquo;s your company called? You can change this any time in Settings.
          </p>
        </div>

        <OnboardingForm suggestedName={org.name} />
      </div>
    </div>
  );
}
