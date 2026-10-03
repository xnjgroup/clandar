import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { checkAuthorizeRequest } from "@/lib/mcp-server-auth";
import { decideAccess } from "./actions";

/** "Allow <agent> to use your Clandar?" — the person approving an AI agent's MCP connection. */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await currentSession();
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  if (!session) redirect(`/oauth/authorize?${new URLSearchParams(params as Record<string, string>).toString()}`);
  const checked = await checkAuthorizeRequest(params);
  if ("redirect" in checked) redirect(checked.redirect);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-[420px] flex-col gap-[18px] rounded-[24px] border border-line bg-surface p-[26px] shadow-[0_20px_60px_rgba(16,18,17,0.08)]">
        {"fatal" in checked ? (
          <>
            <h1 className="m-0 text-[20px] font-bold">Can&apos;t connect</h1>
            <p className="m-0 text-[13.5px] text-muted">{checked.fatal}</p>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-[6px]">
              <span className="text-[12px] font-semibold tracking-[0.08em] text-muted uppercase">Connect an AI agent</span>
              <h1 className="m-0 text-[21px] leading-[1.3] font-bold">
                Allow <span className="text-ink">{checked.ok.client.clientName}</span> to use your Clandar?
              </h1>
            </div>
            <ul className="m-0 flex flex-col gap-[8px] pl-[18px] text-[13.5px] leading-[1.5] text-body">
              <li className="list-disc">
                It can read and change things in <strong>{session!.org.name}</strong> as <strong>{session!.person.name}</strong> — projects,
                customers, schedule, tasks, invoices, email and the Library — using the same tools as Clandar&apos;s own chat.
              </li>
              <li className="list-disc">Posting a comment or trashing email still needs your yes first.</li>
              <li className="list-disc">You can disconnect it any time in Settings → Connected AI agents.</li>
            </ul>
            <p className="m-0 text-[11.5px] break-all text-faint">It will return to {new URL(checked.ok.redirectUri).host || checked.ok.redirectUri}</p>
            <form action={decideAccess} className="flex gap-[10px]">
              <input type="hidden" name="params" value={JSON.stringify(params)} />
              <button
                type="submit"
                name="decision"
                value="deny"
                className="flex-1 cursor-pointer rounded-full border border-line bg-surface py-[11px] text-[13.5px] font-semibold"
              >
                Don&apos;t allow
              </button>
              <button type="submit" name="decision" value="allow" className="flex-1 cursor-pointer rounded-full bg-ink py-[11px] text-[13.5px] font-semibold text-bg">
                Allow
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
