import {
  Card,
  CardTitle,
  EmptyRow,
  IconTile,
  PageBody,
  Pill,
  TableCard,
  TableHeader,
  TableTitle,
} from "@/components/ui";
import { relativeTime, type Tone } from "@/lib/data";
import { listLlmProviders, type ProviderStatus } from "@/lib/llm-providers";
import { listPendingInvites, listTeam, requireSession } from "@/lib/auth";
import { AddLlmForm } from "./add-llm-form";
import { RemoveSampleDataButton, SampleDataOffer } from "@/components/sample-data";
import { demoStatus } from "@/lib/demo-data";
import { listConnectedAgents } from "@/lib/mcp-server-auth";
import { originFromHeaders } from "@/lib/request-origin";
import { headers } from "next/headers";
import { DeleteCompanyForm } from "./delete-company-form";
import { InviteForm } from "./invite-form";
import { ResendInviteButton } from "./resend-invite-button";
import { RenameAssistantForm } from "./rename-assistant-form";
import { RenameOrgForm } from "./rename-org-form";
import { FeatureProviderForm } from "./feature-provider-form";
import {
  cancelInvite,
  changeTeammateRole,
  disconnectAgent,
  makeDefaultProvider,
  removeLlmProvider,
  removeTeammateAction,
  selectChatProvider,
  selectEmailProvider,
  selectInvoiceProvider,
  selectQuoteProvider,
  setLlmModel,
  testLlmProvider,
  toggleLlmProvider,
} from "./actions";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  approver: "Approver",
  member: "Member",
  crew: "Crew",
};

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

export default async function SettingsPage() {
  const { org, person } = await requireSession();
  const [providers, team, invites, demo, agents] = await Promise.all([
    listLlmProviders(org.id),
    listTeam(org.id),
    listPendingInvites(org.id),
    demoStatus(org.id).catch(() => null),
    listConnectedAgents(person.id).catch(() => []),
  ]);
  const mcpUrl = `${originFromHeaders(await headers())}/mcp`;
  const isOwner = person.role === "owner";

  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <CardTitle>Company</CardTitle>
        {isOwner ? (
          <RenameOrgForm currentName={org.name} />
        ) : (
          <span className="text-[12.5px] text-body-soft">{org.name}</span>
        )}
      </Card>

      {/* Clandar as an MCP server: connect Claude, ChatGPT or another agent; see and disconnect them. */}
      <Card className="flex flex-col gap-[12px]">
        <div className="flex flex-col gap-[3px]">
          <CardTitle>Connected AI agents</CardTitle>
          <span className="text-[12px] text-muted">
            Use Clandar from Claude, ChatGPT or any MCP client: add this server URL as a custom connector, sign in, and allow
            it. It works as you, with the same tools as Clandar&apos;s chat.
          </span>
        </div>
        <code className="w-fit rounded-[10px] bg-bg px-[12px] py-[8px] font-mono text-[12.5px] select-all">{mcpUrl}</code>
        {agents.length === 0 ? (
          <span className="text-[12px] text-faint">No agents connected yet.</span>
        ) : (
          <div className="flex flex-col">
            {agents.map((a) => (
              <div key={a.id} className="flex items-center gap-[10px] border-t border-line-soft py-[10px] text-[12.5px]">
                <span className="font-semibold">{a.clientName}</span>
                <span className="text-muted">
                  connected {relativeTime(a.createdAt)}
                  {a.lastUsedAt ? ` · last used ${relativeTime(a.lastUsedAt)}` : ""}
                </span>
                <form action={disconnectAgent} className="ml-auto">
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="cursor-pointer text-bad-fg hover:underline">
                    Disconnect
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Sample data: remove it while it's here; add it to a workspace that's still empty. */}
      {demo?.hasDemo ? (
        <Card className="flex flex-wrap items-center gap-[12px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <CardTitle>Sample data</CardTitle>
            <span className="text-[12px] text-muted">The sample projects, customers, schedule and tasks. Your own work stays.</span>
          </div>
          <RemoveSampleDataButton />
        </Card>
      ) : demo?.isEmpty ? (
        <SampleDataOffer dismissible={false} />
      ) : null}

      <Card>
        <AddLlmForm hasAny={providers.length > 0} />
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Configured providers</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {providers.length} provider{providers.length === 1 ? "" : "s"}
          </span>
        </TableHeader>

        {providers.length === 0 ? (
          <EmptyRow>No providers yet — add one above to point features at a real model.</EmptyRow>
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
                    default
                  </span>
                ) : null}
                {p.isEmailAnalyzer ? (
                  <span className="shrink-0 rounded-full bg-ok-bg px-2 py-[2px] font-mono text-[9.5px] text-ok-fg">
                    email analyzer
                  </span>
                ) : null}
                {p.isChatProvider ? (
                  <span className="shrink-0 rounded-full bg-ok-bg px-2 py-[2px] font-mono text-[9.5px] text-ok-fg">
                    chat
                  </span>
                ) : null}
              </span>
              <span className="truncate text-[11px] text-muted">
                <span className="font-mono">{p.baseUrl}</span>
                {p.hasApiKey ? " · API key set" : ""}
              </span>
              {p.statusDetail ? (
                <span className="truncate text-[11px] text-faint">{p.statusDetail}</span>
              ) : null}
            </div>

            <Pill tone={p.enabled ? STATUS_TONE[p.status] : "idle"}>
              {p.enabled ? STATUS_LABEL[p.status] : "disabled"}
            </Pill>
            <span className="ml-2 shrink-0 font-mono text-[11px] text-faint">
              {relativeTime(p.lastCheckedAt)}
            </span>

            <div className="flex shrink-0 items-center gap-2">
              <form action={testLlmProvider}>
                <input type="hidden" name="id" value={p.id} />
                <button
                  type="submit"
                  className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium"
                >
                  Test
                </button>
              </form>
              {p.isDefault ? null : (
                <form action={makeDefaultProvider}>
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
              <form action={toggleLlmProvider}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="enabled" value={String(!p.enabled)} />
                <button type="submit" className="cursor-pointer text-[11.5px] font-medium underline">
                  {p.enabled ? "Disable" : "Enable"}
                </button>
              </form>
              <form action={removeLlmProvider}>
                <input type="hidden" name="id" value={p.id} />
                <button
                  type="submit"
                  className="cursor-pointer text-[11.5px] font-medium text-bad-fg underline"
                >
                  Remove
                </button>
              </form>
            </div>

            <div className="w-full pl-[46px]">
              {p.availableModels.length > 0 ? (
                <form action={setLlmModel} className="flex items-center gap-2">
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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="flex flex-col gap-[10px]">
          <CardTitle>Email</CardTitle>
          <p className="m-0 text-[11.5px] leading-[1.55] text-muted">
            The provider (and, optionally, a specific model of its own) the Gmail cleanup worker uses to judge and
            summarize messages.
          </p>
          <FeatureProviderForm
            key={`${providers.find((p) => p.isEmailAnalyzer)?.id ?? ""}:${providers.find((p) => p.isEmailAnalyzer)?.emailModel ?? ""}`}
            action={selectEmailProvider}
            providers={providers.map((p) => ({ id: p.id, name: p.name, availableModels: p.availableModels }))}
            initialProviderId={providers.find((p) => p.isEmailAnalyzer)?.id ?? ""}
            initialModel={providers.find((p) => p.isEmailAnalyzer)?.emailModel ?? ""}
          />
        </Card>

        <Card className="flex flex-col gap-[10px]">
          <CardTitle>Chat</CardTitle>
          {isOwner ? (
            <RenameAssistantForm currentName={org.assistantName} />
          ) : (
            <span className="text-[12.5px] text-body-soft">
              The assistant is called <span className="font-semibold text-ink">{org.assistantName}</span>.
            </span>
          )}
          <p className="m-0 text-[11.5px] leading-[1.55] text-muted">
            The provider (and, optionally, a specific model of its own) {org.assistantName} uses to answer questions and
            run its tools.
          </p>
          <FeatureProviderForm
            key={`${providers.find((p) => p.isChatProvider)?.id ?? ""}:${providers.find((p) => p.isChatProvider)?.chatModel ?? ""}`}
            action={selectChatProvider}
            providers={providers.map((p) => ({ id: p.id, name: p.name, availableModels: p.availableModels }))}
            initialProviderId={providers.find((p) => p.isChatProvider)?.id ?? ""}
            initialModel={providers.find((p) => p.isChatProvider)?.chatModel ?? ""}
          />
        </Card>

        <Card className="flex flex-col gap-[10px]">
          <CardTitle>Invoices &amp; receipts</CardTitle>
          <p className="m-0 text-[11.5px] leading-[1.55] text-muted">
            The provider (and, optionally, a specific model) that reads invoices and receipts — uploaded to a project or
            recorded from an email — into invoice records. Pick one that can read images for photographed receipts.
          </p>
          <FeatureProviderForm
            key={`${providers.find((p) => p.isInvoiceProvider)?.id ?? ""}:${providers.find((p) => p.isInvoiceProvider)?.invoiceModel ?? ""}`}
            action={selectInvoiceProvider}
            providers={providers.map((p) => ({ id: p.id, name: p.name, availableModels: p.availableModels }))}
            initialProviderId={providers.find((p) => p.isInvoiceProvider)?.id ?? ""}
            initialModel={providers.find((p) => p.isInvoiceProvider)?.invoiceModel ?? ""}
          />
        </Card>

        <Card className="flex flex-col gap-[10px]">
          <CardTitle>Quotes</CardTitle>
          <p className="m-0 text-[11.5px] leading-[1.55] text-muted">
            The provider (and, optionally, a specific model) that drafts quotes from a project&rsquo;s photos. It needs
            to read images.
          </p>
          <FeatureProviderForm
            key={`${providers.find((p) => p.isQuoteProvider)?.id ?? ""}:${providers.find((p) => p.isQuoteProvider)?.quoteModel ?? ""}`}
            action={selectQuoteProvider}
            providers={providers.map((p) => ({ id: p.id, name: p.name, availableModels: p.availableModels }))}
            initialProviderId={providers.find((p) => p.isQuoteProvider)?.id ?? ""}
            initialModel={providers.find((p) => p.isQuoteProvider)?.quoteModel ?? ""}
          />
        </Card>
      </div>

      <Card className="flex flex-col gap-[13px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <CardTitle>Team</CardTitle>
          <span className="text-[11.5px] text-muted">
            Invite crew or office staff by email — they get an invitation from your connected Gmail and join by signing in with that Google account.
          </span>
        </div>
        {isOwner ? <InviteForm /> : null}
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Members</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {team.length} member{team.length === 1 ? "" : "s"}
          </span>
        </TableHeader>
        {team.map((m) => (
          <div
            key={m.id}
            className="flex min-h-[56px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[12px]"
          >
            <IconTile icon="user" bg="#f2f4ef" fg="#4c4f47" />
            <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
              <span className="truncate text-[13px] font-semibold">{m.name}</span>
              <span className="truncate text-[11px] text-muted">{m.email}</span>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-faint">
              {m.lastLoginAt ? `last in ${relativeTime(m.lastLoginAt)}` : "never signed in"}
            </span>
            {isOwner && m.role !== "owner" ? (
              <form action={changeTeammateRole} className="flex shrink-0 items-center gap-2">
                <input type="hidden" name="id" value={m.id} />
                <select
                  name="role"
                  key={m.role}
                  defaultValue={m.role}
                  className="rounded-[10px] border border-line bg-surface px-2 py-[5px] text-[11.5px] text-ink"
                >
                  <option value="crew">Crew</option>
                  <option value="member">Member</option>
                  <option value="approver">Approver</option>
                </select>
                <button
                  type="submit"
                  className="cursor-pointer rounded-full border border-line px-[10px] py-[5px] text-[11px] font-medium"
                >
                  Save
                </button>
              </form>
            ) : (
              <Pill tone="idle">{ROLE_LABEL[m.role] ?? m.role}</Pill>
            )}
            {isOwner && m.role !== "owner" ? (
              <form action={removeTeammateAction}>
                <input type="hidden" name="id" value={m.id} />
                <button
                  type="submit"
                  className="cursor-pointer text-[11.5px] font-medium text-bad-fg underline"
                >
                  Remove
                </button>
              </form>
            ) : null}
          </div>
        ))}

        {invites.map((invite) => (
          <div
            key={invite.id}
            className="flex min-h-[56px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[12px]"
          >
            <IconTile icon="mail" bg="#fbf2d8" fg="#8a6a1a" />
            <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
              <span className="truncate text-[13px] font-semibold">{invite.email}</span>
              <span className="truncate text-[11px] text-muted">
                Invited {relativeTime(invite.createdAt)} as {ROLE_LABEL[invite.role] ?? invite.role}
              </span>
            </div>
            <Pill tone="warn">pending</Pill>
            {isOwner ? <ResendInviteButton id={invite.id} /> : null}
            {isOwner ? (
              <form action={cancelInvite}>
                <input type="hidden" name="id" value={invite.id} />
                <button
                  type="submit"
                  className="cursor-pointer text-[11.5px] font-medium text-bad-fg underline"
                >
                  Cancel
                </button>
              </form>
            ) : null}
          </div>
        ))}
      </TableCard>

      {isOwner ? (
        <Card className="flex flex-col gap-[13px]">
          <CardTitle>Danger zone</CardTitle>
          <DeleteCompanyForm orgName={org.name} />
        </Card>
      ) : null}
    </PageBody>
  );
}
