import { Icon } from "@/components/icons";
import {
  Card,
  CardTitle,
  IconTile,
  PageBody,
  Pill,
  TableCard,
  TableHeader,
  TableTitle,
} from "@/components/ui";
import { CONNECTORS } from "@/lib/data";

const FORM_FIELDS = [
  { label: "Vendor", value: "PG&E", mono: false },
  { label: "Account number", value: "8829-4471-02", mono: true },
  { label: "Portal username", value: "ap.acmecorp", mono: false },
  { label: "Portal password", value: "••••••••••", mono: false, tracking: true },
];

export default function ConnectorsPage() {
  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <CardTitle>Add a vendor connector</CardTitle>
          <span className="text-[11.5px] text-muted">
            For vendors with no API — a bot logs into their portal and downloads invoices monthly
          </span>
        </div>

        <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-4">
          {FORM_FIELDS.map((field) => (
            <div key={field.label} className="flex flex-col gap-[5px]">
              <span className="text-[11px] text-muted">{field.label}</span>
              <div
                className={`rounded-[12px] border border-line px-3 py-[10px] text-[12.5px] ${
                  field.mono ? "font-mono" : ""
                } ${field.tracking ? "tracking-[2px]" : ""}`}
              >
                {field.value}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-[9px]">
          <Icon name="shield" size={15} className="shrink-0 text-ok-fg" />
          <span className="text-[11.5px] leading-[1.5] text-muted">
            Credentials are encrypted at rest and used only by the download bot — never shown again
            after saving.
          </span>
          <div className="ml-auto flex shrink-0 gap-2">
            <button
              type="button"
              className="cursor-pointer rounded-full border border-line px-[15px] py-[9px] text-[12.5px] font-medium"
            >
              Test login
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg"
            >
              Save &amp; schedule monthly
            </button>
          </div>
        </div>
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Vendor connectors</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {CONNECTORS.length} vendors connected
          </span>
        </TableHeader>

        {CONNECTORS.map((c) => (
          <div
            key={c.vendor}
            className="flex min-h-[64px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[13px]"
          >
            <IconTile
              icon={c.icon}
              bg={c.tone === "bad" ? "#fbeaea" : "#f2f4ef"}
              fg={c.tone === "bad" ? "#8a3232" : "#4c4f47"}
            />
            <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
              <span className="truncate text-[13px] font-semibold">{c.vendor}</span>
              <span className="text-[11px] text-muted">
                {c.method} · acct <span className="font-mono">{c.account}</span>
              </span>
            </div>
            <Pill tone={c.tone}>{c.status}</Pill>
            <span className="ml-2 shrink-0 font-mono text-[11px] text-faint">{c.lastRun}</span>
            <button type="button" className="shrink-0 cursor-pointer text-[11.5px] font-medium underline">
              Manage
            </button>
          </div>
        ))}
      </TableCard>
    </PageBody>
  );
}
