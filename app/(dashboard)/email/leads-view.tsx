import Link from "next/link";
import { Icon } from "@/components/icons";
import { TimeZoneField } from "@/components/time-zone-field";
import { Card, CardTitle, EmptyRow, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { hrefWith, relativeTime, type SearchParams } from "@/lib/data";
import type { EmailLead, LeadFinderSettings } from "@/lib/lead-finder";
import type { ProjectType } from "@/lib/project-types";
import { createProjectFromLead, dismissLead, followUpLead, restoreLead } from "./lead-actions";

const PATH = "/email";

/**
 * Email → Leads: the lead finder's review queue. Each lead shows its project
 * type, who sent it and the AI's two-line read, with one-tap actions — create
 * the project, set a follow-up, or "Not a lead" (which also teaches the finder).
 */
export function LeadsView({
  leads,
  settings,
  handled,
  typeFilter,
  projectTypes,
  params,
  multipleAccounts,
}: {
  leads: EmailLead[];
  settings: LeadFinderSettings;
  handled: boolean;
  typeFilter: string;
  projectTypes: ProjectType[];
  params: SearchParams;
  multipleAccounts: boolean;
}) {
  if (!settings.isEnabled && leads.length === 0 && !handled) {
    return (
      <Card className="flex flex-col items-center gap-[10px] py-9 text-center">
        <span className="flex size-[42px] items-center justify-center rounded-[13px] bg-lime">
          <Icon name="search" size={20} />
        </span>
        <CardTitle>Find project opportunities in your email</CardTitle>
        <span className="max-w-[460px] text-[12.5px] leading-[1.55] text-muted">
          Turn on the lead finder and your email AI will spot requests for work, sort them by your project types, and
          collect them here — with a daily summary.
        </span>
        <Link href="/tasks/scheduled/lead-finder" className="mt-1 rounded-full bg-ink px-[18px] py-[9px] text-[12.5px] font-semibold text-bg">
          Set up the lead finder
        </Link>
      </Card>
    );
  }

  const typesInUse = projectTypes.filter((t) => leads.some((l) => l.projectTypeId === t.id) || t.id === typeFilter);
  const chip = (on: boolean) =>
    `shrink-0 rounded-full px-[11px] py-[5px] text-[11.5px] font-medium ${on ? "bg-ink text-bg" : "border border-line bg-surface text-body"}`;

  return (
    <TableCard>
      <TableHeader>
        <TableTitle>{handled ? "Handled leads" : "Leads"}</TableTitle>
        <span className="font-mono text-[10.5px] text-faint">{leads.length}</span>
        <Link
          href={hrefWith(PATH, params, { view: "leads", handled: handled ? null : "true" })}
          className="ml-auto text-[11.5px] font-medium underline"
        >
          {handled ? "Show open leads" : "Show handled"}
        </Link>
        <Link href="/tasks/scheduled/lead-finder" className="flex items-center gap-[4px] text-[11.5px] font-medium underline">
          <Icon name="settings" size={12} />
          Lead finder
        </Link>
      </TableHeader>

      {typesInUse.length > 1 ? (
        <div className="flex gap-[6px] overflow-x-auto border-b border-line-soft px-[18px] py-[9px] [scrollbar-width:none]">
          <Link href={hrefWith(PATH, params, { view: "leads", type: null })} className={chip(!typeFilter)}>
            All types
          </Link>
          {typesInUse.map((t) => (
            <Link key={t.id} href={hrefWith(PATH, params, { view: "leads", type: t.id })} className={chip(typeFilter === t.id)}>
              {t.name}
            </Link>
          ))}
        </div>
      ) : null}

      {leads.length === 0 ? (
        <EmptyRow>
          {handled
            ? "Nothing handled yet."
            : settings.lastScanAt
              ? `No open leads — last checked ${relativeTime(settings.lastScanAt)}.`
              : "No leads yet — the first scan runs within a few minutes of turning the finder on."}
        </EmptyRow>
      ) : (
        leads.map((lead) => {
          const emailHref = hrefWith(`/email/${lead.messageId}`, {}, {
            view: "leads",
            account: multipleAccounts ? lead.connectorId : null,
          });
          const facts = [lead.details.location, lead.details.timeline, lead.details.budget].filter(Boolean);
          return (
            <div key={lead.id} className="flex flex-col gap-[8px] border-t border-line-soft px-[18px] py-[13px]">
              <div className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
                <span className="rounded-full bg-lime px-[9px] py-[2px] text-[11px] font-semibold text-ink">
                  {lead.projectTypeName || "Other"}
                </span>
                {lead.status === "new" ? <span className="size-[7px] rounded-full bg-ok-fg" title="New" /> : null}
                <Link href={emailHref} className="min-w-0 flex-1 truncate text-[13.5px] font-semibold hover:underline">
                  {lead.title || lead.subject}
                </Link>
                <span className="shrink-0 font-mono text-[11px] text-faint">{relativeTime(lead.receivedAt)}</span>
              </div>
              <div className="flex flex-col gap-[3px] text-[12.5px] leading-[1.5]">
                <span className="text-body-soft">
                  <span className="font-medium text-ink">{lead.fromName || lead.fromEmail}</span>
                  {lead.fromName ? <span className="text-muted"> · {lead.fromEmail}</span> : null}
                </span>
                {lead.summary ? <span className="text-body">{lead.summary}</span> : null}
                {facts.length || lead.details.phone ? (
                  <span className="text-[11.5px] text-muted">
                    {[...facts, lead.details.phone ? `☎ ${lead.details.phone}` : null].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-[8px]">
                {lead.status === "converted" && lead.projectId ? (
                  <Link href={`/projects/${lead.projectId}`} className="rounded-full bg-ok-bg px-3 py-[6px] text-[11.5px] font-semibold text-ok-fg">
                    Project created — open it →
                  </Link>
                ) : lead.status === "dismissed" ? (
                  <>
                    <span className="text-[11.5px] text-muted">Marked not a lead</span>
                    <form action={restoreLead}>
                      <input type="hidden" name="id" value={lead.id} />
                      <button type="submit" className="cursor-pointer text-[11.5px] font-medium underline">
                        Restore
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <form action={createProjectFromLead}>
                      <input type="hidden" name="id" value={lead.id} />
                      <button type="submit" className="cursor-pointer rounded-full bg-ink px-3 py-[6px] text-[11.5px] font-semibold text-bg">
                        Create project
                      </button>
                    </form>
                    <form action={followUpLead}>
                      <input type="hidden" name="id" value={lead.id} />
                      <TimeZoneField />
                      <button type="submit" className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium">
                        {lead.status === "reviewed" ? "Follow up again" : "Follow up"}
                      </button>
                    </form>
                    <form action={dismissLead}>
                      <input type="hidden" name="id" value={lead.id} />
                      <button type="submit" className="cursor-pointer rounded-full px-2 py-[6px] text-[11.5px] font-medium text-muted underline">
                        Not a lead
                      </button>
                    </form>
                  </>
                )}
                <Link href={emailHref} className="ml-auto text-[11.5px] font-medium underline">
                  Read email
                </Link>
              </div>
            </div>
          );
        })
      )}
    </TableCard>
  );
}
