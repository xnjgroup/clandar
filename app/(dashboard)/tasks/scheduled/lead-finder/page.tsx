import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, CardTitle, PageBody, Pill } from "@/components/ui";
import { relativeTime } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { listGmailConnectors } from "@/lib/connectors";
import { countOpenLeads, getLeadFinderSettings } from "@/lib/lead-finder";
import { emailAnalyzerProvider } from "@/lib/llm-providers";
import { listProjectTypes } from "@/lib/project-types";
import { LeadFinderForm } from "./lead-finder-form";

// "Scan now" reads mail and asks the email AI in the request.
export const maxDuration = 300;

/** Automations → Lead finder: what it needs, how it's doing, and its settings. */
export default async function LeadFinderPage() {
  const { org } = await requireSession();
  const [settings, gmail, provider, types, openLeads] = await Promise.all([
    getLeadFinderSettings(org.id),
    listGmailConnectors(org.id),
    emailAnalyzerProvider(org.id),
    listProjectTypes(org.id),
    countOpenLeads(org.id),
  ]);

  const checks = [
    {
      ok: gmail.length > 0,
      label: gmail.length > 0 ? `Gmail connected (${gmail.map((g) => g.accountLabel ?? g.name).join(", ")})` : "Connect a Gmail account",
      href: "/connectors",
    },
    { ok: Boolean(provider), label: provider ? `Email AI: ${provider.name}` : "Set up an AI provider", href: "/settings" },
    {
      ok: types.length > 0,
      label: types.length > 0 ? `${types.length} project types to sort leads into` : "Add your project types",
      href: "/projects/types",
    },
  ];

  return (
    <PageBody>
      <div className="flex items-center gap-[12px]">
        <Link href="/tasks/scheduled" className="text-[11.5px] font-medium underline">
          ← Automations
        </Link>
        <Link href="/email?view=leads" className="text-[11.5px] font-medium underline">
          Open leads{openLeads ? ` (${openLeads} new)` : ""}
        </Link>
      </div>

      <Card className="flex flex-col gap-[12px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[12px] bg-lime">
            <Icon name="search" size={18} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <CardTitle>Lead finder</CardTitle>
            <span className="text-[12.5px] text-muted">
              Finds emails asking for work, sorts them by your project types, and puts them in Email → Leads for you to
              review.
            </span>
          </div>
          <Pill tone={settings.isEnabled ? "ok" : "idle"}>{settings.isEnabled ? "On" : "Off"}</Pill>
        </div>

        <div className="flex flex-wrap gap-x-[18px] gap-y-[6px]">
          {checks.map((c) => (
            <Link key={c.label} href={c.href} className="flex items-center gap-[6px] text-[12px]">
              <span
                className={`flex size-[16px] items-center justify-center rounded-full ${c.ok ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg"}`}
              >
                <Icon name={c.ok ? "check2" : "alert"} size={10} />
              </span>
              <span className={c.ok ? "text-body" : "font-medium text-bad-fg underline"}>{c.label}</span>
            </Link>
          ))}
        </div>

        {settings.lastScanAt ? (
          <span className="text-[11.5px] text-faint">
            Last checked {relativeTime(settings.lastScanAt)}
            {settings.lastScanNote ? ` — ${settings.lastScanNote}` : ""}
          </span>
        ) : null}
      </Card>

      <Card>
        <LeadFinderForm settings={settings} />
      </Card>
    </PageBody>
  );
}
