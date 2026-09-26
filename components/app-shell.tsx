"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { MOBILE_TABS, NAV, PAGE_TITLES, USER_MENU } from "@/lib/data";

function useHeading(pathname: string): [string, string] {
  const [, segment = "", child] = pathname.split("/");
  if (segment === "invoices" && child) return ["Invoices", "Invoice detail"];
  return PAGE_TITLES[segment] ?? PAGE_TITLES[""];
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [crumb, title] = useHeading(pathname);

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[236px_minmax(0,1fr)]">
      <Sidebar pathname={pathname} />

      <main className="flex min-w-0 flex-col gap-[14px] px-[14px] pt-4 pb-24 lg:gap-4 lg:px-[26px] lg:pt-[22px] lg:pb-10">
        <header className="flex min-w-0 items-center gap-[14px]">
          <div className="flex min-w-0 flex-col gap-[2px]">
            <span className="text-[12.5px] text-muted">{crumb}</span>
            <h1 className="m-0 truncate text-[22px] font-bold tracking-[-0.03em]">{title}</h1>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-[9px]">
            <div className="hidden w-[260px] min-w-0 items-center gap-2 rounded-[14px] border border-line bg-surface px-[13px] py-[9px] lg:flex">
              <Icon name="search" size={16} className="text-muted" />
              <span className="truncate text-[13px] text-faint">Search invoices, vendors…</span>
            </div>
            <Link
              href="/invoices"
              className="shrink-0 rounded-full bg-ink px-4 py-[10px] text-[12.5px] font-semibold whitespace-nowrap text-bg"
            >
              + Upload invoice
            </Link>
          </div>
        </header>

        {children}
      </main>

      <nav className="fixed right-0 bottom-0 left-0 z-20 grid grid-cols-4 gap-[2px] border-t border-line bg-surface px-1 pt-[6px] pb-[10px] lg:hidden">
        {MOBILE_TABS.map((tab) => {
          const on = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={on ? "page" : undefined}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[14px] ${
                on ? "bg-ink text-lime" : "text-[#8b918a]"
              }`}
            >
              <Icon name={tab.icon} size={20} />
              <span className="text-[10.5px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen flex-col gap-[14px] border-r border-line bg-bg px-4 pt-[22px] pb-4 lg:flex">
      <div className="flex items-center gap-[10px] px-1 pt-[2px] pb-2">
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-ink text-[14px] font-bold text-lime">
          C.
        </span>
        <span className="text-[16px] font-bold tracking-[-0.02em]">Clandar Expense</span>
      </div>

      <div className="flex flex-col gap-[3px]">
        {NAV.map((item) => {
          const on = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={`flex min-h-[44px] items-center gap-[11px] rounded-[13px] px-[10px] py-[9px] text-[13.5px] ${
                on ? "bg-ink font-semibold text-lime" : "text-body"
              }`}
            >
              <Icon name={item.icon} size={18} />
              <span className="min-w-0">{item.label}</span>
              {item.badge ? (
                <span className="ml-auto shrink-0 rounded-full bg-bad-bg px-[6px] py-[2px] font-mono text-[10px] text-bad-fg">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      <UserMenu />
    </aside>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative mt-auto border-t border-line pt-[10px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex min-h-[52px] w-full min-w-0 cursor-pointer items-center gap-[10px] rounded-[14px] px-[10px] py-[9px] text-left ${
          open ? "bg-[#eceee8]" : "bg-transparent"
        }`}
      >
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-bg">
          MK
        </span>
        <span className="flex min-w-0 flex-col leading-[1.3]">
          <span className="truncate text-[13px] font-semibold">Mei Kwan</span>
          <span className="truncate text-[11px] text-muted">Acme Corp · Owner</span>
        </span>
        <Icon
          name="chev"
          size={15}
          className={`shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="absolute right-0 bottom-[calc(100%+8px)] left-0 z-60 flex flex-col gap-[2px] rounded-[16px] border border-line bg-surface p-[7px] shadow-[0_14px_40px_rgba(16,18,17,0.16)]">
          {USER_MENU.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`flex min-h-[40px] cursor-pointer items-center gap-[11px] rounded-[12px] px-[11px] text-left text-[13px] ${
                item.danger ? "font-medium text-bad-fg" : "text-[#2a2f29]"
              }`}
            >
              <Icon
                name={item.icon}
                size={17}
                className={item.danger ? undefined : "text-body-soft"}
              />
              <span className="min-w-0">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
