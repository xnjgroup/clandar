import { Icon, iconName } from "@/components/icons";
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
import { firstParam, relativeTime, type Tone } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import {
  GOOGLE_SERVICES,
  googleOAuthConfigured,
  listConnectors,
  recentConnectorEvents,
  type Connector,
  type ConnectorStatus,
  type GoogleService,
} from "@/lib/connectors";
import { AddMcpForm } from "./add-mcp-form";
import {
  checkConnector,
  connectGoogle,
  reconnectGoogle,
  signInMcpConnector,
  removeConnector,
  toggleConnector,
} from "./actions";
import { ToolSwitches } from "./tool-switches";

const STATUS_TONE: Record<ConnectorStatus, Tone> = {
  connected: "ok",
  unverified: "warn",
  pending_auth: "warn",
  error: "bad",
  disabled: "idle",
};

const STATUS_LABEL: Record<ConnectorStatus, string> = {
  connected: "connected",
  unverified: "not verified",
  pending_auth: "awaiting consent",
  error: "error",
  disabled: "disabled",
};

const AUTH_LABEL: Record<Connector["authType"], string> = {
  none: "no auth",
  bearer: "bearer token",
  "api-key": "api key",
  basic: "basic auth",
  oauth2: "OAuth",
};

/** An MCP connector's tools with their on/off state. */
function mcpToolSwitches(c: Connector) {
  const disabled = new Set((Array.isArray(c.metadata?.disabledTools) ? c.metadata.disabledTools : []) as string[]);
  return c.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    enabled: !disabled.has(tool.name),
  }));
}

function isGoogleKind(kind: Connector["kind"]): kind is GoogleService {
  return kind === "google_gmail" || kind === "google_calendar";
}

export default async function ConnectorsPage({ searchParams }: PageProps<"/connectors">) {
  const notice = firstParam((await searchParams).notice);
  const { org } = await requireSession();
  const [connectors, events] = await Promise.all([
    listConnectors(org.id),
    recentConnectorEvents(org.id, 5),
  ]);
  const googleReady = googleOAuthConfigured();

  return (
    <PageBody>
      {notice ? (
        <p className="m-0 rounded-[14px] border border-line bg-surface px-[14px] py-[11px] text-[12.5px]">
          {notice}
        </p>
      ) : null}

      <Card>
        <AddMcpForm />
      </Card>

      <Card className="flex flex-col gap-[13px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <CardTitle>Google Workspace</CardTitle>
          <span className="text-[11.5px] text-muted">
            Read-only access, granted through Google&rsquo;s consent screen — connect as many
            accounts as you need
          </span>
        </div>

        {!googleReady ? (
          <p className="m-0 rounded-[12px] bg-warn-bg px-3 py-2 text-[12px] leading-[1.6] text-warn-fg">
            Set <span className="font-mono">GOOGLE_CLIENT_ID</span> and{" "}
            <span className="font-mono">GOOGLE_CLIENT_SECRET</span> in{" "}
            <span className="font-mono">.env.local</span>, then restart the dev server.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {(Object.keys(GOOGLE_SERVICES) as GoogleService[]).map((service) => {
            const definition = GOOGLE_SERVICES[service];
            return (
              <form key={service} action={connectGoogle}>
                <input type="hidden" name="service" value={service} />
                <button
                  type="submit"
                  disabled={!googleReady}
                  className="rounded-full border border-line bg-surface px-[14px] py-[9px] text-[12.5px] font-semibold enabled:cursor-pointer disabled:opacity-40"
                >
                  + Connect a {definition.label} account
                </button>
              </form>
            );
          })}
        </div>
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Connected systems</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {connectors.length} connector{connectors.length === 1 ? "" : "s"}
          </span>
        </TableHeader>

        {connectors.length === 0 ? (
          <EmptyRow>
            Nothing connected yet — add an MCP server above, or connect Gmail or Calendar.
          </EmptyRow>
        ) : null}

        {connectors.map((c) => (
          <div
            key={c.id}
            className="flex min-h-[64px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[13px]"
          >
            <IconTile
              icon={c.kind === "mcp" ? "robot" : iconName(GOOGLE_SERVICES[c.kind as GoogleService]?.icon)}
              bg={c.status === "error" ? "#fbeaea" : "#f2f4ef"}
              fg={c.status === "error" ? "#8a3232" : "#4c4f47"}
            />
            <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
              <span className="truncate text-[13px] font-semibold">{c.name}</span>
              <span className="truncate text-[11px] text-muted">
                {c.kind === "mcp" ? (
                  <>
                    <span className="font-mono">{c.url}</span> · {AUTH_LABEL[c.authType]}
                    {c.toolCount !== null ? ` · ${c.toolCount} tools` : ""}
                  </>
                ) : (
                  <>
                    {AUTH_LABEL[c.authType]} · {c.scopes.length} scope
                    {c.scopes.length === 1 ? "" : "s"}
                    {c.tokenExpiresAt ? ` · token expires ${relativeTime(c.tokenExpiresAt)}` : ""}
                  </>
                )}
              </span>
              {c.statusDetail ? (
                <span className="truncate text-[11px] text-faint">{c.statusDetail}</span>
              ) : null}
            </div>

            <Pill tone={c.enabled ? STATUS_TONE[c.status] : "idle"}>
              {c.enabled ? STATUS_LABEL[c.status] : "disabled"}
            </Pill>
            <span className="ml-2 shrink-0 font-mono text-[11px] text-faint">
              {relativeTime(c.lastCheckedAt)}
            </span>

            <div className="flex shrink-0 items-center gap-2">
              <form action={checkConnector}>
                <input type="hidden" name="id" value={c.id} />
                <button
                  type="submit"
                  className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium"
                >
                  Test
                </button>
              </form>
              {c.kind === "mcp" && (c.authType === "oauth2" || /HTTP 401/.test(c.statusDetail ?? "")) ? (
                <form action={signInMcpConnector}>
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    className={`cursor-pointer rounded-full px-3 py-[6px] text-[11.5px] font-medium ${
                      c.status === "connected" ? "border border-line" : "bg-ink text-bg"
                    }`}
                  >
                    {c.status === "connected" ? "Sign in again" : "Sign in"}
                  </button>
                </form>
              ) : null}
              {isGoogleKind(c.kind) ? (
                <form action={reconnectGoogle}>
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    disabled={!googleReady}
                    className="rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium enabled:cursor-pointer disabled:opacity-40"
                  >
                    Reconnect
                  </button>
                </form>
              ) : null}
              <form action={toggleConnector}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="enabled" value={String(!c.enabled)} />
                <button type="submit" className="cursor-pointer text-[11.5px] font-medium underline">
                  {c.enabled ? "Disable" : "Enable"}
                </button>
              </form>
              <form action={removeConnector}>
                <input type="hidden" name="id" value={c.id} />
                <button
                  type="submit"
                  className="cursor-pointer text-[11.5px] font-medium text-bad-fg underline"
                >
                  Remove
                </button>
              </form>
            </div>

            {c.tools.length > 0 ? (
              c.kind === "mcp" ? (
                <ToolSwitches connectorId={c.id} connectorName={c.name} tools={mcpToolSwitches(c)} />
              ) : (
                <div className="flex w-full flex-wrap gap-[6px] pl-[46px]">
                  {c.tools.map((tool) => (
                    <span
                      key={tool.name}
                      title={tool.description}
                      className="rounded-full bg-idle-bg px-2 py-[3px] font-mono text-[10px] text-body-soft"
                    >
                      {tool.name}
                    </span>
                  ))}
                </div>
              )
            ) : null}
          </div>
        ))}
      </TableCard>

      {events.length > 0 ? (
        <Card className="flex flex-col gap-[10px]">
          <span className="font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
            Connector activity
          </span>
          {events.map((event) => (
            <div key={event.id} className="flex min-w-0 items-baseline gap-[10px]">
              <Icon
                name={event.ok ? "check2" : "alertSm"}
                size={14}
                className={`mt-[2px] shrink-0 ${event.ok ? "text-ok-fg" : "text-bad-fg"}`}
              />
              <span className="min-w-0 flex-1 text-[12.5px] leading-[1.5]">
                <span className="font-semibold">{event.connector}</span> · {event.message}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-faint">
                {relativeTime(event.at)}
              </span>
            </div>
          ))}
        </Card>
      ) : null}
    </PageBody>
  );
}
