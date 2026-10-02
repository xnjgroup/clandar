import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { redirect } from "next/navigation";
import "../globals.css";
import { SiteAnalytics } from "@/components/site-analytics";
import { AppShell } from "@/components/app-shell";
import { isAdminEmail } from "@/lib/admin";
import { requireSession, signOutAction } from "@/lib/auth";
import { demoStatus } from "@/lib/demo-data";
import { navCounts } from "@/lib/queries";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/** `cover` lets pages run under the iPhone home indicator, so the floating tab bar can sit just above it (env(safe-area-inset-bottom)). */
export const viewport: Viewport = {
  viewportFit: "cover",
};

// No title here: the app shell renders "<page> · Clandar" for each page (components/app-shell.tsx).
export const metadata: Metadata = {
  description:
    "Spending, bills, budgets, projects, AI estimates, scheduling, and tasks — with an AI assistant.",
  // SVG only (brand/clandar-logo-v2/favicon.svg): a light tile, dark in dark-mode browsers.
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
};

/**
 * Every page reads from Postgres, so nothing here is prerendered at build time.
 */
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The DAL primitive (see lib/auth.ts) — redirects to /login when there's no
  // valid session, before any page under this layout ever renders.
  const session = await requireSession();
  // A brand-new org's owner names it before seeing the dashboard at all —
  // everyone else (crew joining an org already named) skips straight past.
  if (!session.org.onboarded && session.person.role === "owner") redirect("/onboarding");
  const [badges, demo] = await Promise.all([
    navCounts(session.org.id),
    // Never let this take a page down (e.g. before db:setup has made demo_records).
    demoStatus(session.org.id).catch(() => null),
  ]);

  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <AppShell
          user={{
            name: session.person.name,
            role: session.person.role,
            email: session.person.email,
            avatarUrl: session.person.avatarUrl,
          }}
          orgName={session.org.name}
          assistantName={session.org.assistantName}
          badges={badges}
          isAdmin={isAdminEmail(session.person.email)}
          onSignOut={signOutAction}
          sampleData={demo?.hasDemo ? { hasOwnData: demo.hasOwnData } : null}
        >
          {children}
        </AppShell>
      </body>
      <SiteAnalytics />
    </html>
  );
}
