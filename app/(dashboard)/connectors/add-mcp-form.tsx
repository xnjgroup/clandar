"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icons";
import { CardTitle } from "@/components/ui";
import { addMcpServer, type FormState } from "./actions";

const AUTH_OPTIONS = [
  { value: "none", label: "No auth" },
  { value: "bearer", label: "Bearer token" },
  { value: "api-key", label: "API key header" },
  { value: "basic", label: "Basic auth" },
] as const;

const SECRET_LABEL: Record<string, string> = {
  bearer: "Token",
  "api-key": "API key",
  basic: "user:password",
};

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

export function AddMcpForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addMcpServer, {});
  const [open, setOpen] = useState(false);
  const [authType, setAuthType] = useState<string>("none");

  // A successful save collapses the form back to the button — the new row
  // already appeared in the table below, so there's nothing left to do here.
  // Adjusting state during render (rather than in an effect) is the pattern
  // React recommends for reacting to a value changing between renders.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.ok) {
      setOpen(false);
      setAuthType("none");
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-[10px]">
        <CardTitle>MCP servers</CardTitle>
        <span className="text-[11.5px] text-muted">
          Any remote server speaking MCP over HTTP
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto shrink-0 cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg"
        >
          + Add MCP server
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-[13px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <CardTitle>Add an MCP server</CardTitle>
        <span className="text-[11.5px] text-muted">
          The handshake runs as soon as you save
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto shrink-0 cursor-pointer text-[11.5px] font-medium underline"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-4">
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Name</span>
          <input name="name" required placeholder="Vendor portal MCP" className={inputClass} />
        </label>

        <label className="flex flex-col gap-[5px] lg:col-span-2">
          <span className="text-[11px] text-muted">Server URL</span>
          <input
            name="url"
            type="url"
            required
            inputMode="url"
            placeholder="https://mcp.example.com/mcp"
            className={`${inputClass} font-mono`}
          />
        </label>

        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Authentication</span>
          <select
            name="authType"
            value={authType}
            onChange={(e) => setAuthType(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            {AUTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {authType === "api-key" ? (
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Header name</span>
            <input
              name="headerName"
              defaultValue="X-API-Key"
              className={`${inputClass} font-mono`}
            />
          </label>
        ) : null}

        {authType === "none" ? null : (
          <label className="flex flex-col gap-[5px] lg:col-span-2">
            <span className="text-[11px] text-muted">{SECRET_LABEL[authType]}</span>
            <input
              name="secret"
              type="password"
              autoComplete="off"
              placeholder={authType === "basic" ? "user:password" : "••••••••••"}
              className={inputClass}
            />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-[9px]">
        <Icon name="shield" size={15} className="shrink-0 text-ok-fg" />
        <span className="text-[11.5px] leading-[1.5] text-muted">
          Credentials are encrypted with AES-256-GCM before they are written to Postgres, and are
          never sent back to the browser.
        </span>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto shrink-0 rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-50"
        >
          {pending ? "Connecting…" : "Save & test connection"}
        </button>
      </div>

      {state.error ? (
        <p className="m-0 rounded-[12px] bg-bad-bg px-3 py-2 text-[12px] leading-[1.5] text-bad-fg">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="m-0 rounded-[12px] bg-ok-bg px-3 py-2 text-[12px] leading-[1.5] text-ok-fg">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
