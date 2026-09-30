import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "../globals.css";

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
  title: "Sign in — Clandar",
  description: "Sign in to your company's Clandar workspace.",
  // SVG only (brand/clandar-logo-v2/favicon.svg): a light tile, dark in dark-mode browsers.
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
};

export const dynamic = "force-dynamic";

/**
 * A second root layout (no `app/layout.tsx` at the top — see
 * `app/(dashboard)/layout.tsx`, the other one) so the sign-in page never runs
 * the dashboard's `requireSession()` check, which would just redirect back
 * here forever.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-bg font-sans">{children}</body>
    </html>
  );
}
