"use client";

import { useState, useTransition, type ReactNode } from "react";
import ReactGridLayout, { useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Icon } from "@/components/icons";

export type DashboardWidget = { id: string; title: string; node: ReactNode };
export type WidgetPlacement = { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number };

/** Below this width the grid isn't worth dragging around — widgets stack in layout order. */
const GRID_MIN_WIDTH = 900;
const COLS = 12;
const ROW_HEIGHT = 30;
const GAP = 12;

/** Layout order for stacking: top to bottom, then left to right. */
function byPosition(a: WidgetPlacement, b: WidgetPlacement) {
  return a.y - b.y || a.x - b.x;
}

/**
 * A dashboard of widgets the person can rearrange: a pencil icon switches to
 * edit mode, where each widget can be dragged by its bar and resized from its
 * corner (react-grid-layout). The layout is saved per person via `onSave`.
 * On narrow screens widgets simply stack in the saved order.
 */
export function DashboardGrid({
  widgets,
  layout: initialLayout,
  defaultLayout,
  onSave,
}: {
  widgets: DashboardWidget[];
  layout: WidgetPlacement[];
  defaultLayout: WidgetPlacement[];
  onSave: (layout: WidgetPlacement[]) => Promise<void>;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [layout, setLayout] = useState<WidgetPlacement[]>(initialLayout);
  const [editing, setEditing] = useState(false);
  const [saving, startSaving] = useTransition();
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const useGrid = mounted && width >= GRID_MIN_WIDTH;

  function persist(next: readonly LayoutItem[]) {
    const clean = next.map(({ i, x, y, w, h }) => {
      const base = defaultLayout.find((d) => d.i === i);
      return { i, x, y, w, h, minW: base?.minW, minH: base?.minH };
    });
    setLayout(clean);
    startSaving(() => onSave(clean));
  }

  return (
    <div className="flex min-w-0 flex-col gap-[10px]">
      <div className="flex min-h-[32px] items-center justify-end gap-[10px]">
        {editing ? (
          <>
            <span className="mr-auto text-[12px] text-muted">
              Drag a widget by its bar to move it; drag its bottom-right corner to resize.
              {saving ? " Saving…" : ""}
            </span>
            <button
              type="button"
              onClick={() => persist(defaultLayout as LayoutItem[])}
              className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[12px] font-medium"
            >
              Reset layout
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="cursor-pointer rounded-full bg-ink px-4 py-[6px] text-[12px] font-semibold text-bg"
            >
              Done
            </button>
          </>
        ) : useGrid ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit dashboard layout"
            title="Edit dashboard layout — move and resize widgets"
            className="flex size-8 cursor-pointer items-center justify-center rounded-[10px] border border-line bg-surface text-body-soft hover:text-ink"
          >
            <Icon name="brush" size={15} />
          </button>
        ) : null}
      </div>

      <div ref={containerRef} className="min-w-0">
        {useGrid ? (
          <ReactGridLayout
            width={width}
            layout={layout as Layout}
            gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [GAP, GAP], containerPadding: [0, 0] }}
            dragConfig={{ enabled: editing, handle: ".dashboard-drag" }}
            resizeConfig={{ enabled: editing, handles: ["se"] }}
            onDragStop={(next) => persist(next)}
            onResizeStop={(next) => persist(next)}
          >
            {layout
              .filter((p) => byId.has(p.i))
              .map((p) => (
                <div key={p.i} className={`flex min-h-0 min-w-0 flex-col ${editing ? "rounded-[22px] outline-2 outline-dashed outline-offset-2 outline-line" : ""}`}>
                  {editing ? (
                    <div className="dashboard-drag flex shrink-0 cursor-grab items-center gap-[6px] rounded-t-[14px] border border-b-0 border-line bg-line-soft px-[10px] py-[4px] text-[11px] font-medium text-body-soft hover:bg-line active:cursor-grabbing">
                      <Icon name="menu" size={12} />
                      {byId.get(p.i)!.title}
                    </div>
                  ) : null}
                  {/* The widget fills its cell and scrolls if its content is taller. */}
                  <div className="min-h-0 flex-1 overflow-auto [&>*]:min-h-full">{byId.get(p.i)!.node}</div>
                </div>
              ))}
          </ReactGridLayout>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {[...layout]
              .sort(byPosition)
              .filter((p) => byId.has(p.i))
              .map((p) => (
                <div key={p.i} className="min-w-0">
                  {byId.get(p.i)!.node}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
