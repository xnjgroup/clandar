import {
  Card,
  EmptyRow,
  IconTile,
  PageBody,
  Pill,
  TableCard,
  TableHeader,
  TableTitle,
} from "@/components/ui";
import { count, relativeTime, type Tone } from "@/lib/data";
import { listAllOrganizations, requireAdmin } from "@/lib/admin";
import { jobCounts, listRunners, recentJobs } from "@/lib/jobs";
import { listPlatformLlmProviders } from "@/lib/platform-llm-providers";
import type { ProviderStatus } from "@/lib/llm-providers";
import { AddPlatformProviderForm } from "./add-platform-provider-form";
import {
  adminCancelJob,
  adminRetryJob,
  impersonatePerson,
  makePlatformDefault,
  removePlatformProvider,
  setPlatformModel,
  testPlatformProvider,
  togglePlatformProvider,
} from "./actions";

const STATUS_TONE: Record<ProviderStatus, Tone> = {
  connected: "ok",
  unverified: "warn",
  error: "bad",
  disabled: "idle",
};

const STATUS_LABEL: Record<ProviderStatus, string> = {
  connected: "connected",
  unverified: "not verified",
  error: "error",
  disabled: "disabled",
};

export default async function AdminPage() {
  const { person } = await requireAdmin();
  const [providers, orgs, jobs, runners, counts] = await Promise.all([
    listPlatformLlmProviders(),
    listAllOrganizations(),
    recentJobs(60),
    listRunners(),
    jobCounts(),
  ]);

  return (
    <PageBody>
      <p className="m-0 rounded-[12px] bg-idle-bg px-3 py-2 text-[11.5px] leading-[1.5] text-body-soft">
        Platform admin — visible only to accounts listed in <code>ADMIN_EMAILS</code>. Nothing here is
        scoped to one organization.
      </p>

      <Card>
        <AddPlatformProviderForm hasAny={providers.length > 0} />
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Platform providers</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {providers.length} provider{providers.length === 1 ? "" : "s"}
          </span>
        </TableHeader>

        {providers.length === 0 ? (
          <EmptyRow>
            No platform provider configured — every org must bring its own until you add one here.
          </EmptyRow>
        ) : null}

        {providers.map((p) => (
          <div
            key={p.id}
            className="flex min-h-[64px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[13px]"
          >
            <IconTile
              icon="bot"
              bg={p.status === "error" ? "#fbeaea" : "#f2f4ef"}
              fg={p.status === "error" ? "#8a3232" : "#4c4f47"}
            />
            <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
              <span className="flex min-w-0 items-center gap-[7px]">
                <span className="truncate text-[13px] font-semibold">{p.name}</span>
                {p.isDefault ? (
                  <span className="shrink-0 rounded-full bg-idle-bg px-2 py-[2px] font-mono text-[9.5px] text-body-soft">
                    platform default
                  </span>
                ) : null}
              </span>
              <span className="truncate text-[11px] text-muted">
                <span className="font-mono">{p.baseUrl}</span>
                {p.hasApiKey ? " · API key set" : ""}
              </span>
              {p.statusDetail ? <span className="truncate text-[11px] text-faint">{p.statusDetail}</span> : null}
            </div>

            <Pill tone={p.enabled ? STATUS_TONE[p.status] : "idle"}>
              {p.enabled ? STATUS_LABEL[p.status] : "disabled"}
            </Pill>
            <span className="ml-2 shrink-0 font-mono text-[11px] text-faint">{relativeTime(p.lastCheckedAt)}</span>

            <div className="flex shrink-0 items-center gap-2">
              <form action={testPlatformProvider}>
                <input type="hidden" name="id" value={p.id} />
                <button
                  type="submit"
                  className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium"
                >
                  Test
                </button>
              </form>
              {p.isDefault ? null : (
                <form action={makePlatformDefault}>
                  <input type="hidden" name="id" value={p.id} />
                  <button
                    type="submit"
                    disabled={!p.enabled}
                    className="rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium enabled:cursor-pointer disabled:opacity-40"
                  >
                    Make default
                  </button>
                </form>
              )}
              <form action={togglePlatformProvider}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="enabled" value={String(!p.enabled)} />
                <button type="submit" className="cursor-pointer text-[11.5px] font-medium underline">
                  {p.enabled ? "Disable" : "Enable"}
                </button>
              </form>
              <form action={removePlatformProvider}>
                <input type="hidden" name="id" value={p.id} />
                <button type="submit" className="cursor-pointer text-[11.5px] font-medium text-bad-fg underline">
                  Remove
                </button>
              </form>
            </div>

            <div className="w-full pl-[46px]">
              {p.availableModels.length > 0 ? (
                <form action={setPlatformModel} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <span className="text-[11px] text-muted">Model</span>
                  <select
                    name="model"
                    key={p.model ?? p.availableModels[0]}
                    defaultValue={p.model ?? p.availableModels[0]}
                    className="rounded-[10px] border border-line bg-surface px-2 py-[5px] font-mono text-[11.5px] text-ink"
                  >
                    {p.availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="cursor-pointer rounded-full border border-line px-[10px] py-[4px] text-[11px] font-medium"
                  >
                    Use
                  </button>
                </form>
              ) : (
                <span className="text-[11px] text-faint">
                  {p.status === "error"
                    ? "No models to choose from — fix the error above and test again."
                    : "No models discovered yet — Test to list what this endpoint offers."}
                </span>
              )}
            </div>
          </div>
        ))}
      </TableCard>

      {/* Background jobs: who's running them, and every job running, waiting or recently finished. */}
      <TableCard>
        <TableHeader>
          <TableTitle>Background jobs</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {counts.running} running · {counts.queued} waiting · {counts.failed} failed this week
          </span>
        </TableHeader>
        <div className="flex flex-col gap-[6px] border-t border-line-soft px-[18px] py-[12px] text-[12.5px]">
          <span className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">Runners</span>
          {runners.length === 0 ? (
            <span className="text-faint">
              No runner has checked in. Start one with <code className="font-mono">npm run runner</code> (the dev server runs one too); on
              Vercel, /api/cron/tick covers reminders and automations.
            </span>
          ) : (
            runners.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-[2px]">
                <span className={`size-[8px] shrink-0 rounded-full ${r.online ? "bg-ok-fg" : "bg-line"}`} />
                <span className="font-semibold">{r.name}</span>
                <span className="text-muted">{r.hostname}</span>
                <span className="text-muted">{r.online ? (r.currentJob ? `running ${r.currentJob}` : "idle") : `offline · last seen ${relativeTime(r.lastSeen)}`}</span>
                <span className="ml-auto font-mono text-[11px] text-faint">up since {relativeTime(r.startedAt)}</span>
              </div>
            ))
          )}
        </div>
        {jobs.length === 0 ? (
          <EmptyRow>No jobs yet.</EmptyRow>
        ) : (
          jobs.map((j) => {
            const tone = j.status === "running" ? "ok" : j.status === "failed" ? "bad" : j.status === "queued" ? "warn" : "idle";
            const progress = j.progress.total ? `${(j.progress.done ?? 0).toLocaleString("en-US")} / ${j.progress.total.toLocaleString("en-US")}` : null;
            return (
              <div key={j.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-[3px] border-t border-line-soft px-[18px] py-[10px] text-[12.5px]">
                <Pill tone={tone}>{j.progress.paused ? "paused" : j.status}</Pill>
                <span className="font-semibold">{j.kind}</span>
                <span className="text-muted">{j.orgName ?? "—"}</span>
                {progress ? <span className="font-mono text-[11px] text-body-soft">{progress}</span> : null}
                {j.lockedBy && j.status === "running" ? <span className="text-[11px] text-faint">on {j.lockedBy}</span> : null}
                {j.attempts > 1 ? <span className="text-[11px] text-faint">attempt {j.attempts}/{j.maxAttempts}</span> : null}
                <span className="ml-auto font-mono text-[11px] text-faint">
                  {j.status === "queued" && j.runAfter > new Date() ? `retry ${relativeTime(j.runAfter)}` : relativeTime(j.finishedAt ?? j.startedAt ?? j.createdAt)}
                </span>
                {j.status === "queued" || j.status === "running" ? (
                  <form action={adminCancelJob}>
                    <input type="hidden" name="id" value={j.id} />
                    <button type="submit" className="cursor-pointer text-[11.5px] text-bad-fg hover:underline" disabled={j.control === "cancel"}>
                      {j.control === "cancel" ? "Cancelling…" : "Cancel"}
                    </button>
                  </form>
                ) : j.status === "failed" || j.status === "cancelled" ? (
                  <form action={adminRetryJob}>
                    <input type="hidden" name="id" value={j.id} />
                    <button type="submit" className="cursor-pointer text-[11.5px] font-medium hover:underline">
                      Retry
                    </button>
                  </form>
                ) : null}
                {j.error ? <span className="w-full truncate pl-[2px] text-[11.5px] text-bad-fg">{j.error}</span> : null}
              </div>
            );
          })
        )}
      </TableCard>

      <TableCard>
        <TableHeader>
          <TableTitle>Organizations</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {count(orgs.length)} org{orgs.length === 1 ? "" : "s"}
          </span>
        </TableHeader>
        {orgs.length === 0 ? (
          <EmptyRow>No organizations yet.</EmptyRow>
        ) : (
          orgs.map((org) => (
            // Collapsed to one line; open it for the members.
            <details key={org.id} className="group border-t border-line-soft">
              <summary className="flex min-h-[52px] min-w-0 cursor-pointer list-none flex-wrap items-center gap-3 px-[18px] py-[12px] hover:bg-[#fafbf9] [&::-webkit-details-marker]:hidden">
                <span className="shrink-0 text-[11px] text-faint transition-transform group-open:rotate-90">▶</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{org.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {org.memberCount} member{org.memberCount === 1 ? "" : "s"}
                </span>
                {!org.onboarded ? <Pill tone="warn">not onboarded</Pill> : null}
                <span className="shrink-0 font-mono text-[11px] text-faint">{relativeTime(org.createdAt)}</span>
              </summary>
              <div className="flex flex-col pb-[8px] pl-[42px] pr-[18px]">
                {org.members.length === 0 ? (
                  <span className="py-[6px] text-[12px] text-faint">No members.</span>
                ) : (
                  org.members.map((m) => (
                    <div key={m.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-[2px] border-t border-line-soft py-[8px] text-[12.5px] first:border-t-0">
                      <span className="min-w-0 font-medium">{m.name}</span>
                      <span className="min-w-0 truncate text-muted">{m.email}</span>
                      <Pill tone={m.role === "owner" ? "ok" : "idle"}>{m.role}</Pill>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">
                        {m.lastLoginAt ? `signed in ${relativeTime(m.lastLoginAt)}` : "never signed in"}
                      </span>
                      {m.id !== person.id ? (
                        <form action={impersonatePerson}>
                          <input type="hidden" name="personId" value={m.id} />
                          <button type="submit" className="shrink-0 cursor-pointer rounded-full border border-line px-[10px] py-[3px] text-[11.5px] font-medium hover:bg-bg">
                            Sign in as
                          </button>
                        </form>
                      ) : (
                        <span className="shrink-0 text-[11.5px] text-faint">you</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </details>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}

