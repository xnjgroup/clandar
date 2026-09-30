"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Google Analytics 4 property for clandar.com — a public ID, overridable with NEXT_PUBLIC_GA_ID. */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "G-XW7TKD2MGK";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * The address GA sees for a page: the path only (no ?query — email searches, filters, errors),
 * with record ids collapsed so every project/task/email groups together:
 * /projects/5f3c…-…/files → /projects/:id/files.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GMAIL_ID = /^[0-9a-f]{12,}$/i;

export function analyticsPath(pathname: string): string {
  return pathname
    .split("/")
    .map((part, i, parts) => {
      // /invoices/<vendor-slug>/… — the slug is a vendor's name, i.e. business data.
      if (i === 2 && parts[1] === "invoices" && part) return ":vendor";
      return UUID.test(part) || GMAIL_ID.test(part) || /^\d+$/.test(part) ? ":id" : part;
    })
    .join("/");
}

/** "Projects", "Tasks · Scheduled", "Home" — a readable name for reports; the tab title is always "Clandar". */
function analyticsTitle(path: string): string {
  const words = path
    .split("/")
    .filter((p) => p && p !== ":id")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).replace(/-/g, " "));
  return words.length ? words.join(" · ") : "Home";
}

/**
 * Google Analytics on every page (both root layouts), production only. Page views are sent by
 * hand on each navigation with a cleaned address and title, instead of GA's automatic ones —
 * those would send full URLs, query strings included. In the GA property, turn off Enhanced
 * measurement's "Page changes based on browser history events" and "Site search" so GA doesn't
 * add its own full-URL page views next to these.
 */
export function SiteAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !pathname) return;
    const path = analyticsPath(pathname);
    // Set gtag up here (once), before the first page view: calls queue in dataLayer until the
    // library (loaded below) arrives, so nothing is lost and "config" always comes first.
    if (!window.gtag) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params -- gtag.js expects the arguments object itself
        window.dataLayer!.push(arguments);
      };
      window.gtag("js", new Date());
      window.gtag("config", GA_ID, { send_page_view: false });
    }
    window.gtag("event", "page_view", {
      page_location: `${window.location.origin}${path}`,
      page_path: path,
      page_title: analyticsTitle(path),
      page_referrer: document.referrer ? new URL(document.referrer).origin : undefined,
    });
  }, [pathname]);

  if (process.env.NODE_ENV !== "production") return null;
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />;
}
