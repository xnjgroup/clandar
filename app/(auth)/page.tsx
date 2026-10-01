import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { currentSession } from "@/lib/auth";
import { firstParam } from "@/lib/data";
import { LoginCard } from "./login/login-card";
import { SignInLink } from "./login/sign-in-link";
import { BrandLockup } from "@/components/brand-lockup";

export const metadata: Metadata = {
  title: "Clandar — your personal chief of staff",
  description:
    "For your household or your business: Clandar tracks spending and bills, keeps every project on budget and on schedule, and gives you an AI assistant that handles the busywork — receipts, reminders, budgets and follow-ups.",
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
    icon: "wallet",
    title: "Spending & bills",
    body: "Ask Clandar to read a bill, invoice, or receipt from your inbox and it becomes a tracked expense — by category, month, and project.",
    preview: (
      <MiniScreen>
        <MiniRow icon="bolt" title="Electric bill" sub="$86.40 · due Oct 8" tone="warn" toneLabel="due soon" />
        <MiniRow icon="doc" title="Grocery run" sub="$142.30 · Food" tone="ok" toneLabel="logged" />
      </MiniScreen>
    ),
  },
  {
    icon: "chart",
    title: "Budgets & alerts",
    body: "Set monthly budgets and get a heads-up on duplicate charges, price hikes, and subscriptions you forgot about.",
    preview: (
      <MiniScreen>
        <div className="flex flex-col gap-[5px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <div className="flex justify-between text-[10.5px]">
            <span className="font-medium">Dining out</span>
            <span className="text-body-soft">$312 of $400</span>
          </div>
          <div className="h-[5px] overflow-hidden rounded-full bg-idle-bg">
            <div className="h-full w-[78%] rounded-full bg-ink" />
          </div>
        </div>
        <MiniRow icon="alert" title="Streaming plan" sub="Up $3/mo from last month" tone="warn" toneLabel="price hike" />
      </MiniScreen>
    ),
  },
  {
    icon: "briefcase",
    title: "Projects",
    body: "Client jobs, renovations, trips, side gigs — each with its own budget, schedule, tasks, files, and photos.",
    preview: (
      <MiniScreen>
        <MiniRow icon="home" title="Kitchen refresh" sub="$3,120 of $8,500" tone="ok" toneLabel="on budget" />
        <MiniRow icon="briefcase" title="Deck repair — Maria Chen" sub="Client job · Thu 1:30" tone="warn" toneLabel="quoted" />
      </MiniScreen>
    ),
  },
  {
    icon: "camera",
    title: "Estimates from photos",
    body: "Snap a few photos of a repair or a job site and get a line-by-line estimate — to budget for it, or to send as a quote.",
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
          <span>Estimate</span>
          <span>$365</span>
        </div>
      </MiniScreen>
    ),
  },
  {
    icon: "calendar",
    title: "Calendar & tasks",
    body: "Appointments, to-dos, shopping lists, and reminders in one place — with a briefing every morning.",
    preview: (
      <MiniScreen>
        <div className="flex items-center gap-[8px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <span className="flex size-[14px] shrink-0 items-center justify-center rounded-[4px] bg-ok-bg text-ok-fg">
            <Icon name="check2" size={9} />
          </span>
          <span className="truncate text-[11px] text-faint line-through">Pay water bill</span>
        </div>
        <div className="flex items-center gap-[8px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <span className="size-[14px] shrink-0 rounded-[4px] border border-line" />
          <span className="truncate text-[11px] font-medium">Book hotel — due Friday</span>
        </div>
        <div className="flex items-center gap-[8px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <span className="size-[14px] shrink-0 rounded-[4px] border border-line" />
          <span className="truncate text-[11px] font-medium">Renew car registration</span>
        </div>
      </MiniScreen>
    ),
  },
  {
    icon: "bot",
    title: "Your AI assistant",
    body: "Ask where the money went, or have it do the work — file a receipt, add a task, plan a trip, reply to a customer.",
    preview: (
      <MiniScreen>
        <MiniRow icon="mail" title="Con Edison" sub="Your September bill is ready" tone="warn" toneLabel="new" />
        <div className="flex items-center gap-[7px] rounded-[10px] bg-surface px-[9px] py-[7px]">
          <Icon name="bot" size={13} className="shrink-0 text-body-soft" />
          <span className="truncate text-[10.5px] text-body-soft">Added $86.40 to Utilities — reminder set</span>
        </div>
      </MiniScreen>
    ),
  },
];

const VALUE_PROPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "chart",
    title: "Know where your money goes",
    body: "Every expense lands in a category and a budget, so surprises show up before the statement does.",
  },
  {
    icon: "shield",
    title: "Nothing gets dropped",
    body: "Bills, projects, customers, and to-dos live in one place instead of six apps, a spreadsheet, and a notebook.",
  },
  {
    icon: "clock",
    title: "Hours back every week",
    body: "Receipts, reminders, and follow-ups that used to eat your evenings now sort themselves out.",
  },
];

const STEPS = [
  {
    title: "Sign in",
    body: "Use Apple, Google, or just your email — no setup, nothing to install.",
  },
  {
    title: "Connect your inbox",
    body: "Ask Clandar about any email — it files bills and receipts as expenses, flags new customer requests, and drafts replies.",
  },
  {
    title: "Ask your assistant",
    body: "Plan a project, set a budget, or ask what's due this week — it keeps everything organized as you go.",
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
        <BrandLockup />
        <a
          href="#features"
          className="ml-auto hidden shrink-0 px-[10px] py-[9px] text-[12.5px] font-medium text-body-soft hover:text-ink sm:block"
        >
          What it does
        </a>
        <SignInLink className="shrink-0 rounded-full bg-ink px-[16px] py-[9px] text-[12.5px] font-semibold text-bg max-sm:ml-auto">
          Sign in
        </SignInLink>
      </header>

      {/* First screen: sign in (left) beside a preview of the product (right); phones stack them. */}
      <section
        id="signin"
        className="mx-auto grid w-full max-w-[1120px] scroll-mt-4 grid-cols-1 items-center gap-[36px] px-5 pt-[26px] pb-[60px] lg:grid-cols-2 lg:gap-[48px] lg:px-8 lg:pt-[48px] lg:pb-[90px]"
      >
        <div className="flex flex-col items-center gap-[18px] text-center">
          <h1 className="m-0 max-w-[520px] text-[32px] leading-[1.12] font-bold tracking-[-0.03em] lg:text-[44px]">
            Your personal chief of staff
          </h1>
          <p className="m-0 max-w-[440px] text-[14.5px] leading-[1.6] text-body-soft">
            Track spending and bills, keep every project on budget, and let an AI assistant handle the receipts,
            reminders, and follow-ups.
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
                  <Icon name="home" size={17} />
                </span>
                <div className="flex min-w-0 flex-col text-left leading-[1.3]">
                  <span className="truncate text-[12.5px] font-semibold">Kitchen refresh</span>
                  <span className="truncate text-[11px] text-muted">Home project · 6 tasks</span>
                </div>
                <span className="ml-auto shrink-0 rounded-full bg-ok-bg px-[9px] py-[3px] text-[10.5px] font-medium text-ok-fg">
                  On budget
                </span>
              </div>
              <div className="flex flex-col gap-[6px] rounded-[12px] border border-line bg-bg px-[12px] py-[9px] text-left">
                <div className="flex justify-between text-[11.5px]">
                  <span className="text-body-soft">Spent so far</span>
                  <span className="font-semibold">$3,120 of $8,500</span>
                </div>
                <div className="h-[6px] overflow-hidden rounded-full bg-idle-bg">
                  <div className="h-full w-[37%] rounded-full bg-ink" />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-[8px] rounded-[18px] border border-line bg-surface p-[14px] text-left shadow-[0_14px_40px_rgba(16,18,17,0.08)]">
              <span className="text-[11px] font-semibold text-body-soft">Thursday</span>
              {[
                ["9:00 AM", "Contractor walk-through", "Kitchen refresh · 14 Oak St"],
                ["1:30 PM", "Client call", "Deck repair quote · Maria Chen"],
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
                Good morning — the electric bill ($86.40) is due Friday, and dining out is at 78% of this
                month&rsquo;s budget. Want a reminder for the bill?
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto w-full max-w-[1120px] px-5 py-[50px] lg:px-8">
        <div className="mb-[30px] flex flex-col items-center gap-[8px] text-center">
          <h2 className="m-0 text-[26px] font-bold tracking-[-0.02em] lg:text-[30px]">
            Your money, your projects, one assistant
          </h2>
          <p className="m-0 max-w-[520px] text-[13.5px] leading-[1.6] text-body-soft">
            Spending, budgets, bills, projects, calendar, and tasks in one place — with an AI assistant that keeps it
            all in order. For your household, your business, or both.
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
            Sign in and Clandar is ready — no setup, nothing to install.
          </p>
          <SignInLink className="flex items-center gap-[10px] rounded-full bg-lime px-[22px] py-[13px] text-[14px] font-semibold text-ink">
            Get started
          </SignInLink>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-[1120px] flex-col items-center gap-[8px] px-5 py-[26px] text-center lg:px-8">
        <span className="text-[12.5px] font-semibold">Clandar</span>
        <span className="text-[11px] text-faint">Money, projects, and an AI assistant — for your life and your business.</span>
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
