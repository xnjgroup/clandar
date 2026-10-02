"use client";

import { useOptimistic, useTransition } from "react";
import { ModalDialog } from "@/components/modal-dialog";
import { setMcpTools, toggleMcpTool } from "./actions";

type Tool = { name: string; description: string; enabled: boolean };

/**
 * An MCP connector's tools: a one-line summary on the row, and a "Configure tools" dialog to switch
 * each on or off for the assistant.
 */
export function ToolSwitches({ connectorId, connectorName, tools }: { connectorId: string; connectorName: string; tools: Tool[] }) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(tools, (current, change: { names: string[]; enabled: boolean }) =>
    current.map((t) => (change.names.includes(t.name) ? { ...t, enabled: change.enabled } : t)),
  );
  const onCount = optimistic.filter((t) => t.enabled).length;

  function toggle(tool: Tool) {
    const enabled = !tool.enabled;
    startTransition(async () => {
      setOptimistic({ names: [tool.name], enabled });
      const form = new FormData();
      form.set("id", connectorId);
      form.set("tool", tool.name);
      form.set("enabled", String(enabled));
      await toggleMcpTool(form);
    });
  }

  function setAll(enabled: boolean) {
    startTransition(async () => {
      setOptimistic({ names: optimistic.map((t) => t.name), enabled });
      const form = new FormData();
      form.set("id", connectorId);
      form.set("disabled", JSON.stringify(enabled ? [] : optimistic.map((t) => t.name)));
      await setMcpTools(form);
    });
  }

  return (
    <div className="flex w-full items-center gap-[10px] pl-[46px] text-[11.5px] text-muted">
      <span>
        The assistant can use {onCount} of {optimistic.length} tool{optimistic.length === 1 ? "" : "s"}
      </span>
      <ModalDialog
        title={`${connectorName} — tools`}
        trigger={(open) => (
          <button type="button" onClick={open} className="cursor-pointer font-medium text-ink underline">
            Configure tools
          </button>
        )}
      >
        {() => (
          <div className="flex flex-col gap-[12px]">
            <div className="flex items-center gap-[10px] text-[11.5px] text-muted">
              <span>
                {onCount} of {optimistic.length} on
              </span>
              <span className="ml-auto flex shrink-0 gap-[10px] font-medium whitespace-nowrap">
                <button type="button" onClick={() => setAll(true)} className="cursor-pointer underline">
                  All on
                </button>
                <button type="button" onClick={() => setAll(false)} className="cursor-pointer underline">
                  All off
                </button>
              </span>
            </div>
            {/* Only this list scrolls: sized to leave the dialog's title and controls room, so the dialog itself never does. */}
            <div className="flex max-h-[calc(100dvh-240px)] flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-[14px] border border-line">
              {optimistic.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-start gap-[10px] border-b border-line-soft px-[14px] py-[10px] last:border-b-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    {/* Tool names are long and space-less (gridservice_create_api_…): break anywhere. */}
                    <span className="font-mono text-[12px] break-all text-ink">{tool.name}</span>
                    {tool.description ? (
                      <span className="line-clamp-2 text-[11.5px] leading-[1.45] break-words text-muted">{tool.description}</span>
                    ) : null}
                  </span>
                  {/* On/off: ink when on. relative keeps the hidden checkbox inside its row. */}
                  <label className="relative mt-[2px] shrink-0 cursor-pointer" title={tool.enabled ? "On" : "Off"}>
                    <input type="checkbox" checked={tool.enabled} onChange={() => toggle(tool)} className="peer sr-only" />
                    <span
                      aria-hidden
                      className="relative block h-[20px] w-[34px] rounded-full bg-line transition-colors peer-checked:bg-ink peer-focus-visible:outline peer-focus-visible:outline-2 after:absolute after:top-[2px] after:left-[2px] after:size-[16px] after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-[14px]"
                    />
                    <span className="sr-only">Use {tool.name}</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
