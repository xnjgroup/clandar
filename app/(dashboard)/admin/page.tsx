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
import { listPlatformLlmProviders } from "@/lib/platform-llm-providers";
import type { ProviderStatus } from "@/lib/llm-providers";
import { AddPlatformProviderForm } from "./add-platform-provider-form";
import {
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
  await requireAdmin();
  const [providers, orgs] = await Promise.all([listPlatformLlmProviders(), listAllOrganizations()]);

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
            <div
              key={org.id}
              className="flex min-h-[52px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[12px]"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{org.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-faint">
                {org.memberCount} member{org.memberCount === 1 ? "" : "s"}
              </span>
              {!org.onboarded ? <Pill tone="warn">not onboarded</Pill> : null}
              <span className="shrink-0 font-mono text-[11px] text-faint">{relativeTime(org.createdAt)}</span>
            </div>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}

