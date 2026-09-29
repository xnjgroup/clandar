import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "../globals.css";
import { AppShell } from "@/components/app-shell";
import { requireSession, signOutAction } from "@/lib/auth";
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

export const metadata: Metadata = {
  title: "Clandar",
  description:
    "Customers, jobs, AI-assisted quoting, scheduling, tasks, and invoice/expense tracking.",
};

/**
 * Every page reads from Postgres, so nothing here is prerendered at build time.
 */
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The DAL primitive (see lib/auth.ts) — redirects to /login when there's no
  // valid session, before any page under this layout ever renders.
  const [session, badges] = await Promise.all([requireSession(), navCounts()]);

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
          badges={badges}
          onSignOut={signOutAction}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
