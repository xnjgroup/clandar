import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { currentSession } from "@/lib/auth";
import { firstParam } from "@/lib/data";
import { LoginCard } from "./login/login-card";

export const metadata: Metadata = {
  title: "Clandar — the AI assistant for business owners who do it all",
  description:
    "Clandar quotes jobs from photos, manages your schedule, chases invoices, and answers customer email — the assistant your business doesn't have to hire.",
};

/* ── Feature tile previews — small mocked-up "screens", not real screenshots ── */

function MiniScreen({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[7px] rounded-[13px] border border-line bg-bg p-[10px]">{children}</div>;
}

function MiniRow({
  icon,
  title,
  sub,
  tone,
  toneLabel,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  tone?: "ok" | "warn" | "idle";
  toneLabel?: string;
}) {
  const toneClass = { ok: "bg-ok-bg text-ok-fg", warn: "bg-warn-bg text-warn-fg", idle: "bg-idle-bg text-body-soft" };
  return (
    <div className="flex items-center gap-[8px] rounded-[10px] bg-surface px-[9px] py-[7px]">
      <Icon name={icon} size={13} className="shrink-0 text-body-soft" />
      <div className="flex min-w-0 flex-1 flex-col leading-[1.25]">
        <span className="truncate text-[11px] font-medium">{title}</span>
        {sub ? <span className="truncate text-[10px] text-faint">{sub}</span> : null}
      </div>
      {toneLabel ? (
        <span className={`shrink-0 rounded-full px-[7px] py-[2px] text-[9px] font-medium ${toneClass[tone ?? "idle"]}`}>
          {toneLabel}
        </span>
      ) : null}
    </div>
  );
}

const FEATURES: { icon: IconName; title: string; body: string; preview: ReactNode }[] = [
  {
    icon: "briefcase",
    title: "Customers & Projects",
    body: "Every customer, every property, every project — tracked in one place from first call to final invoice.",
    preview: (
      <MiniScreen>
        <MiniRow icon="briefcase" title="Repaint kitchen" sub="Jordan Alvarez" tone="warn" toneLabel="Quoted" />
        <MiniRow icon="briefcase" title="Deck repair" sub="Maria Chen" tone="ok" toneLabel="Scheduled" />
      </MiniScreen>
    ),
  },
  {
    icon: "camera",
    title: "AI quoting",
    body: "Snap photos of the job site and get a line-itemized estimate in seconds, ready to review and send.",
    preview: (
      <MiniScreen>
        <div className="flex items-center gap-[7px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <Icon name="camera" size={13} className="shrink-0 text-body-soft" />
          <span className="text-[10.5px] text-body-soft">3 photos analyzed</span>
        </div>
        <div className="flex flex-col gap-[3px] px-[2px] text-[10px] text-faint">
          <div className="flex justify-between">
            <span>Labor — 6 hrs</span>
            <span>$270</span>
          </div>
          <div className="flex justify-between">
            <span>Paint &amp; supplies</span>
            <span>$95</span>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-[10px] bg-ink px-[9px] py-[6px] text-[10.5px] font-semibold text-lime">
          <span>Total</span>
          <span>$365</span>
        </div>
      </MiniScreen>
    ),
  },
  {
    icon: "calendar",
    title: "Scheduling",
    body: "See the whole crew's week at a glance, and never double-book a job again.",
    preview: (
      <MiniScreen>
        <MiniRow icon="calendar" title="9:00 — Repaint kitchen" sub="Sam" />
        <MiniRow icon="calendar" title="1:00 — Deck repair" sub="Alex" />
        <MiniRow icon="calendar" title="3:30 — Site walk-through" sub="Sam" />
      </MiniScreen>
    ),
  },
  {
    icon: "clipboard",
    title: "Task management",
    body: "To-dos, shopping lists, and reminders — nothing falls through the cracks.",
    preview: (
      <MiniScreen>
        <div className="flex items-center gap-[8px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <span className="flex size-[14px] shrink-0 items-center justify-center rounded-[4px] bg-ok-bg text-ok-fg">
            <Icon name="check2" size={9} />
          </span>
          <span className="truncate text-[11px] text-faint line-through">Buy drop cloths</span>
        </div>
        <div className="flex items-center gap-[8px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <span className="size-[14px] shrink-0 rounded-[4px] border border-line" />
          <span className="truncate text-[11px] font-medium">Deck permit — due Friday</span>
        </div>
        <div className="flex items-center gap-[8px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <span className="size-[14px] shrink-0 rounded-[4px] border border-line" />
          <span className="truncate text-[11px] font-medium">Order tile, 40 sq ft</span>
        </div>
      </MiniScreen>
    ),
  },
  {
    icon: "mail",
    title: "Customer support",
    body: "Read, summarize, and reply to customer email without leaving the app.",
    preview: (
      <MiniScreen>
        <MiniRow icon="mail" title="Maria Chen" sub="Can we push Thursday to 2pm?" tone="warn" toneLabel="new" />
        <div className="flex items-center gap-[7px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <Icon name="bot" size={13} className="shrink-0 text-body-soft" />
          <span className="truncate text-[10.5px] text-body-soft">Draft reply ready — confirm 2:00 PM</span>
        </div>
      </MiniScreen>
    ),
  },
  {
    icon: "wallet",
    title: "Invoices & expenses",
    body: "Track spend, approvals, and budgets automatically, with fraud checks built in.",
    preview: (
      <MiniScreen>
        <MiniRow icon="doc" title="Ace Hardware" sub="$142.30" tone="ok" toneLabel="approved" />
        <MiniRow icon="doc" title="Sherwin-Williams" sub="$286.10" tone="warn" toneLabel="pending" />
      </MiniScreen>
    ),
  },
];

const VALUE_PROPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "clock",
    title: "Hours back every week",
    body: "Quoting, scheduling, and follow-ups that used to eat your evenings now happen in the background.",
  },
  {
    icon: "shield",
    title: "Nothing gets dropped",
    body: "Every customer, task, and invoice lives in one system instead of six sticky notes and a notebook.",
  },
  {
    icon: "check2",
    title: "Looks professional",
    body: "Send polished, itemized estimates and timely replies without hiring an office manager.",
  },
];

const STEPS = [
  {
    title: "Sign in with Google",
    body: "Connect your Gmail in one click — no setup, no software to install.",
  },
  {
    title: "Add your customers and jobs",
    body: "Or let the AI draft your first estimate straight from a few photos of the site.",
  },
  {
    title: "Let it run",
    body: "Schedules, reminders, and customer replies stay organized automatically as work happens.",
  },
];

/**
 * The front door: sign in on the first screen (the same card as the old /login, which now
 * redirects here), and what Clandar does as you scroll.
 */
export default async function LandingPage({ searchParams }: PageProps<"/">) {
  const session = await currentSession();
  if (session) redirect("/overview");
  const error = firstParam((await searchParams).error);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-[1120px] items-center gap-[10px] px-5 py-5 lg:px-8">
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-[9px] bg-ink text-[14px] font-bold text-lime">
          C.
        </span>
        <span className="text-[16px] font-bold tracking-[-0.02em]">Clandar</span>
        <a
          href="#features"
          className="ml-auto hidden shrink-0 px-[10px] py-[9px] text-[12.5px] font-medium text-body-soft hover:text-ink sm:block"
        >
          What it does
        </a>
        <a
          href="#signin"
          className="shrink-0 rounded-full bg-ink px-[16px] py-[9px] text-[12.5px] font-semibold text-bg max-sm:ml-auto"
        >
          Sign in
        </a>
      </header>

      {/* First screen: sign in (left) beside a preview of the product (right); phones stack them. */}
      <section
        id="signin"
        className="mx-auto grid w-full max-w-[1120px] scroll-mt-4 grid-cols-1 items-center gap-[36px] px-5 pt-[26px] pb-[60px] lg:grid-cols-2 lg:gap-[48px] lg:px-8 lg:pt-[48px] lg:pb-[90px]"
      >
        <div className="flex flex-col items-center gap-[18px] text-center">
          <h1 className="m-0 max-w-[520px] text-[32px] leading-[1.12] font-bold tracking-[-0.03em] lg:text-[44px]">
            The assistant every business owner wishes they could afford
          </h1>
          <p className="m-0 max-w-[440px] text-[14.5px] leading-[1.6] text-body-soft">
            Quotes from photos, a straight schedule, invoices chased, email answered — so you can get back to
            the real work.
          </p>
          <LoginCard error={error || undefined} />
          <a href="#features" className="text-[12.5px] font-medium text-muted underline hover:text-ink">
            See what Clandar does ↓
          </a>
        </div>

        {/* A product preview, drawn in the app's own style — not a screenshot. */}
        <div className="relative mx-auto w-full max-w-[480px] rounded-[26px] bg-[linear-gradient(160deg,#eef3e2,#f6f7f3_55%,#e9ede2)] p-[18px] lg:p-[26px]">
          <div className="flex flex-col gap-[12px]">
            <div className="flex flex-col gap-[10px] rounded-[18px] border border-line bg-surface p-[14px] shadow-[0_14px_40px_rgba(16,18,17,0.08)]">
              <div className="flex items-center gap-[10px]">
                <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-ok-bg text-ok-fg">
                  <Icon name="briefcase" size={17} />
                </span>
                <div className="flex min-w-0 flex-col text-left leading-[1.3]">
                  <span className="truncate text-[12.5px] font-semibold">Repaint kitchen &amp; hallway</span>
                  <span className="truncate text-[11px] text-muted">Jordan Alvarez · Painting</span>
                </div>
                <span className="ml-auto shrink-0 rounded-full bg-warn-bg px-[9px] py-[3px] text-[10.5px] font-medium text-warn-fg">
                  Quoted
                </span>
              </div>
              <div className="flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[12px] py-[9px] text-left">
                <Icon name="camera" size={15} className="shrink-0 text-body-soft" />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-body-soft">
                  AI estimate from 3 photos — $1,240
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-ok-fg">Send</span>
              </div>
            </div>

            <div className="flex flex-col gap-[8px] rounded-[18px] border border-line bg-surface p-[14px] text-left shadow-[0_14px_40px_rgba(16,18,17,0.08)]">
              <span className="text-[11px] font-semibold text-body-soft">Thursday</span>
              {[
                ["9:00 AM", "Tile install", "Smith bathroom · 14 Oak St"],
                ["1:30 PM", "Estimate visit", "Nguyen deck · 88 Pine Ave"],
              ].map(([time, what, where]) => (
                <div key={time} className="flex items-start gap-[10px]">
                  <span className="mt-[5px] size-[8px] shrink-0 rounded-full bg-ink" />
                  <div className="flex min-w-0 flex-col leading-[1.35]">
                    <span className="font-mono text-[10.5px] text-muted">{time}</span>
                    <span className="text-[12px] font-semibold">{what}</span>
                    <span className="truncate text-[11px] text-muted">{where}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-end gap-[8px]">
              <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[10px] bg-lime">
                <Icon name="bot" size={15} />
              </span>
              <div className="rounded-[16px] rounded-bl-[6px] bg-ink px-[13px] py-[10px] text-left text-[12px] leading-[1.5] text-bg shadow-[0_14px_40px_rgba(16,18,17,0.14)]">
                Good morning — 2 jobs today, 22 min between them. The Nguyen quote is 3 days old; want me to
                follow up?
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto w-full max-w-[1120px] px-5 py-[50px] lg:px-8">
        <div className="mb-[30px] flex flex-col items-center gap-[8px] text-center">
          <h2 className="m-0 text-[26px] font-bold tracking-[-0.02em] lg:text-[30px]">
            Everything an assistant would do — done by Clandar
          </h2>
          <p className="m-0 max-w-[520px] text-[13.5px] leading-[1.6] text-body-soft">
            One place for customers, jobs, quotes, schedule, tasks, and the money — built for a business run by
            one person, or a small crew.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col gap-[13px] rounded-[18px] border border-line bg-surface p-[16px]">
              <div className="flex items-center gap-[10px]">
                <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-idle-bg text-body">
                  <Icon name={f.icon} size={17} />
                </span>
                <span className="text-[14px] font-semibold">{f.title}</span>
              </div>
              {f.preview}
              <p className="m-0 text-[12px] leading-[1.5] text-body-soft">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Value props */}
      <section className="bg-surface py-[50px]">
        <div className="mx-auto w-full max-w-[1120px] px-5 lg:px-8">
          <div className="grid grid-cols-1 gap-[26px] sm:grid-cols-3">
            {VALUE_PROPS.map((v) => (
              <div key={v.title} className="flex flex-col items-center gap-[10px] text-center">
                <span className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-lime text-ink">
                  <Icon name={v.icon} size={19} />
                </span>
                <span className="text-[14.5px] font-semibold">{v.title}</span>
                <p className="m-0 max-w-[280px] text-[12.5px] leading-[1.55] text-body-soft">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-[1120px] px-5 py-[54px] lg:px-8">
        <h2 className="m-0 mb-[30px] text-center text-[26px] font-bold tracking-[-0.02em] lg:text-[30px]">
          Up and running in three steps
        </h2>
        <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex flex-col gap-[9px]">
              <span className="flex size-[30px] items-center justify-center rounded-full bg-ink font-mono text-[12.5px] font-semibold text-lime">
                {i + 1}
              </span>
              <span className="text-[14px] font-semibold">{step.title}</span>
              <p className="m-0 text-[12.5px] leading-[1.55] text-body-soft">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-ink py-[54px] text-center">
        <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-[18px] px-5">
          <h2 className="m-0 text-[26px] font-bold tracking-[-0.02em] text-bg lg:text-[30px]">
            Ready to get your evenings back?
          </h2>
          <p className="m-0 text-[13.5px] leading-[1.6] text-[#b7bcb2]">
            Sign in and your workspace is ready — no setup, nothing to install.
          </p>
          <a
            href="#signin"
            className="flex items-center gap-[10px] rounded-full bg-lime px-[22px] py-[13px] text-[14px] font-semibold text-ink"
          >
            Get started
          </a>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-[1120px] flex-col items-center gap-[8px] px-5 py-[26px] text-center lg:px-8">
        <span className="text-[12.5px] font-semibold">Clandar</span>
        <span className="text-[11px] text-faint">Built for business owners who wear every hat.</span>
        <div className="flex gap-[14px] text-[11px] text-faint">
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          <Link href="/terms" className="underline">
            Terms
          </Link>
        </div>
      </footer>
    </div>
  );
}
