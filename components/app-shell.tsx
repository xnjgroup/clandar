"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { AssistantWidget } from "@/components/assistant-widget";
import { HEADER_ACTIONS_ID } from "@/components/header-actions";
import { playSound, unlockSoundOnInteraction } from "@/components/notification-sound";
import { useNotifications } from "@/components/use-notifications";
import { MOBILE_TABS, NAV_FOOTER, NAV_GROUPS, NAV_TOP, PAGE_TITLES, USER_MENU, greeting } from "@/lib/data";
import { BrandLockup } from "@/components/brand-lockup";

const ASSISTANT_OPEN_KEY = "clandar:assistant-open";

function useHeading(pathname: string, userName: string | null): [string, string] {
  const [, segment = "", child] = pathname.split("/");
  if (segment === "invoices" && child) return ["Invoices", "Invoice detail"];
  if (segment === "projects" && child && child !== "new" && child !== "types") return ["Projects", "Project detail"];
  if (segment === "customers" && child) return ["Customers", "Customer detail"];
  const [crumb, title] = PAGE_TITLES[segment] ?? PAGE_TITLES.overview;
  return [segment === "overview" ? greeting(userName) : crumb, title];
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Which submenus are expanded. Defaults to only the group containing the
 * current page; a manual toggle just lives in this component's state, which
 * survives client-side navigation fine since the sidebar never unmounts
 * between dashboard pages — no persistence needed beyond that.
 *
 * Re-deriving which group should be forced open when `pathname` changes is
 * done by adjusting state during render (comparing against a tracked copy of
 * the last-seen active group) rather than in an effect — the pattern React
 * recommends for resetting/deriving state from a changed prop.
 */
function useOpenGroups(pathname: string) {
  const activeGroup = NAV_GROUPS.find((g) => g.items.some((i) => isActive(pathname, i.href)))?.label ?? null;

  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NAV_GROUPS.map((g) => [g.label, g.label === activeGroup])),
  );

  const [trackedGroup, setTrackedGroup] = useState(activeGroup);
  if (activeGroup !== trackedGroup) {
    setTrackedGroup(activeGroup);
    if (activeGroup) setOpen((prev) => (prev[activeGroup] ? prev : { ...prev, [activeGroup]: true }));
  }

  const toggle = (label: string) => setOpen((prev) => ({ ...prev, [label]: !prev[label] }));

  return { open, toggle };
}

function NavRow({
  href,
  icon,
  label,
  badgeCount,
  active,
  indent,
  size,
}: {
  href: string;
  icon: IconName;
  label: string;
  badgeCount?: number;
  active: boolean;
  indent?: boolean;
  size: "desktop" | "mobile";
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-[11px] rounded-[13px] px-[10px] py-[9px] ${
        size === "desktop" ? "min-h-[44px] text-[13.5px]" : "min-h-[46px] text-[14px]"
      } ${indent ? "pl-[30px]" : ""} ${active ? "bg-ink font-semibold text-lime" : "text-body"}`}
    >
      <Icon name={icon} size={size === "desktop" ? 18 : 19} />
      <span className="min-w-0">{label}</span>
      {badgeCount ? (
        <span className="ml-auto shrink-0 rounded-full bg-bad-bg px-[6px] py-[2px] font-mono text-[10px] text-bad-fg">
          {badgeCount}
        </span>
      ) : null}
    </Link>
  );
}

/** The full nav content — top-level rows, two collapsible submenus, then the pinned footer. Shared by the desktop sidebar and the mobile drawer. */
function NavContent({
  pathname,
  badges,
  isAdmin,
  size,
}: {
  pathname: string;
  badges: Record<string, number>;
  isAdmin: boolean;
  size: "desktop" | "mobile";
}) {
  const { open, toggle } = useOpenGroups(pathname);

  return (
    <div className="flex flex-col gap-[3px]">
      {NAV_TOP.map((item) => (
        <NavRow
          key={item.href}
          href={item.href}
          icon={item.icon}
          label={item.label}
          badgeCount={badges[item.href]}
          active={isActive(pathname, item.href)}
          size={size}
        />
      ))}

      {NAV_GROUPS.map((group) => {
        const groupBadgeCount = group.items.reduce((sum, i) => sum + (badges[i.href] ?? 0), 0);
        const isOpen = open[group.label];
        return (
          <div key={group.label} className="flex flex-col gap-[3px]">
            <button
              type="button"
              onClick={() => toggle(group.label)}
              aria-expanded={isOpen}
              className={`flex items-center gap-[11px] rounded-[13px] px-[10px] py-[9px] text-left text-body-soft ${
                size === "desktop" ? "min-h-[44px] text-[13.5px]" : "min-h-[46px] text-[14px]"
              }`}
            >
              <Icon name={group.icon} size={size === "desktop" ? 18 : 19} />
              <span className="min-w-0 font-medium">{group.label}</span>
              {!isOpen && groupBadgeCount ? (
                <span className="ml-auto shrink-0 rounded-full bg-bad-bg px-[6px] py-[2px] font-mono text-[10px] text-bad-fg">
                  {groupBadgeCount}
                </span>
              ) : null}
              <Icon
                name="chev"
                size={14}
                className={`${groupBadgeCount && !isOpen ? "" : "ml-auto"} shrink-0 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen
              ? group.items.map((item) => (
                  <NavRow
                    key={item.href}
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    badgeCount={badges[item.href]}
                    active={isActive(pathname, item.href)}
                    indent
                    size={size}
                  />
                ))
              : null}
          </div>
        );
      })}

      <div className="my-[5px] border-t border-line-soft" />

      {NAV_FOOTER.map((item) => (
        <NavRow
          key={item.href}
          href={item.href}
          icon={item.icon}
          label={item.label}
          badgeCount={badges[item.href]}
          active={isActive(pathname, item.href)}
          size={size}
        />
      ))}

      {isAdmin ? (
        <NavRow
          href="/admin"
          icon="key"
          label="Admin"
          active={isActive(pathname, "/admin")}
          size={size}
        />
      ) : null}
    </div>
  );
}

export type ShellUser = { name: string; role: string; email: string; avatarUrl: string | null } | null;

/** The user's Google photo if we have one, else their initials on a solid tile — same footprint either way. */
function Avatar({ user, size }: { user: ShellUser; size: number }) {
  const className = "shrink-0 rounded-full object-cover";
  if (user?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Google-hosted photo, not worth a next/image remote-pattern config for one avatar
      <img
        src={user.avatarUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`${className} flex items-center justify-center bg-ink text-[12px] font-semibold text-bg`}
      style={{ width: size, height: size }}
    >
      {user ? initials(user.name) : "—"}
    </span>
  );
}

export function AppShell({
  children,
  user,
  orgName,
  assistantName,
  badges,
  isAdmin,
  onSignOut,
}: {
  children: ReactNode;
  user: ShellUser;
  orgName: string;
  /** What the team calls its assistant (Settings → Chat). */
  assistantName: string;
  badges: Record<string, number>;
  isAdmin: boolean;
  onSignOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [crumb, title] = useHeading(pathname, user?.name ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  // Notifications live in the assistant: their unread count badges its button, and it
  // opens on its Updates tab when there's something new (otherwise on the chat).
  const notifications = useNotifications();
  const [assistantTab, setAssistantTab] = useState<"chat" | "updates">("chat");
  function openAssistant(tab?: "chat" | "updates") {
    // A reply that finished while it was closed wins: open on the chat to show it.
    setAssistantTab(tab ?? (assistantActivity === "replied" ? "chat" : notifications.unread > 0 ? "updates" : "chat"));
    setAssistantOpen(true);
    if (assistantActivity === "replied") setAssistantActivity("idle");
  }
  // The chat keeps working while closed: "working" pulses its button, "replied" bounces it until opened.
  const [assistantActivity, setAssistantActivity] = useState<"idle" | "working" | "replied">("idle");

  // Sounds (components/notification-sound.ts): a chime with each new notification's ring, a lighter
  // note when a reply lands while the chat is closed. Audio unlocks on the first click or key press.
  useEffect(() => unlockSoundOnInteraction(), []);
  useEffect(() => {
    if (notifications.ring > 0) playSound("notification");
  }, [notifications.ring]);
  useEffect(() => {
    if (assistantActivity === "replied") playSound("reply");
  }, [assistantActivity]);

  // A navigation ends the visit that opened the drawer — close it so the next
  // page doesn't render underneath an open overlay. Adjusting state during
  // render (rather than in an effect) is the pattern React recommends for
  // resetting state when a prop changes: https://react.dev/learn/you-might-not-need-an-effect
  const [renderedFor, setRenderedFor] = useState(pathname);
  if (pathname !== renderedFor) {
    setRenderedFor(pathname);
    setMenuOpen(false);
  }

  // Lets a page (e.g. the overview card's "Ask about this") open the panel
  // without needing a route to link to — dispatch `new CustomEvent("clandar:open-assistant")`.
  useEffect(() => {
    // Always the chat: these carry a question to ask.
    const onOpenRequest = () => {
      setAssistantTab("chat");
      setAssistantOpen(true);
    };
    window.addEventListener("clandar:open-assistant", onOpenRequest);
    return () => window.removeEventListener("clandar:open-assistant", onOpenRequest);
  }, []);

  // `?chat=<conversation id>` (a briefing's notification or push) opens that conversation in the
  // assistant, then drops the parameter so a refresh doesn't reopen it.
  useEffect(() => {
    const url = new URL(window.location.href);
    const conversationId = url.searchParams.get("chat");
    if (!conversationId) return;
    url.searchParams.delete("chat");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    window.dispatchEvent(new CustomEvent("clandar:open-assistant", { detail: { conversationId } }));
  }, [pathname]);

  // Whether the panel was open persists across a refresh — a per-browser
  // convenience, so it's read after mount (not in the initial useState) to
  // avoid a server/client mismatch on the first render.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage (not a prop) must happen post-mount to avoid a server/client mismatch; there's no "adjust during render" equivalent for an external read like this.
      if (localStorage.getItem(ASSISTANT_OPEN_KEY) === "true") setAssistantOpen(true);
    } catch {
      // Private browsing or storage disabled — the panel just starts closed.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ASSISTANT_OPEN_KEY, String(assistantOpen));
    } catch {
      // Nothing to fall back to — losing the preference for this session is fine.
    }
  }, [assistantOpen]);

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[236px_minmax(0,1fr)]">
      <Sidebar
        pathname={pathname}
        user={user}
        orgName={orgName}
        badges={badges}
        isAdmin={isAdmin}
        onSignOut={onSignOut}
      />
      <MobileNav
        pathname={pathname}
        user={user}
        orgName={orgName}
        badges={badges}
        isAdmin={isAdmin}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSignOut={onSignOut}
      />

      <div className="flex min-w-0">
        {/* Bottom padding: on phones, room for the floating tab bar above the home indicator; on desktop, room for the floating assistant
            button (components/assistant-widget.tsx) — 24px up + 52px tall. */}
        <main className="flex min-w-0 flex-1 flex-col gap-[14px] px-[14px] pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] lg:gap-4 lg:px-[26px] lg:pt-[22px] lg:pb-[96px]">
          <header className="flex min-w-0 items-center gap-[14px]">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[12px] border border-line bg-surface lg:hidden"
            >
              <Icon name="menu" size={18} />
            </button>
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="text-[12.5px] text-muted">{crumb}</span>
              <h1 className="m-0 truncate text-[22px] font-bold tracking-[-0.03em]">{title}</h1>
            </div>
            {/* A page's main action, placed here by <HeaderActions> (components/header-actions.tsx). */}
            <div id={HEADER_ACTIONS_ID} className="ml-auto flex shrink-0 items-center gap-[8px]" />
          </header>

          {children}
        </main>

        <AssistantWidget
          open={assistantOpen}
          onOpenChange={(next) => (next ? openAssistant() : setAssistantOpen(false))}
          tab={assistantTab}
          onTabChange={setAssistantTab}
          notifications={notifications}
          name={assistantName}
          activity={assistantActivity}
          onActivity={setAssistantActivity}
          pageContext={`${title} (${pathname})`}
        />
      </div>

      {/* Phones: a floating, frosted tab bar — inset from the edges, above the home indicator — with the
          active tab in solid ink + lime. The last tab opens the assistant. */}
      <nav
        className="fixed inset-x-[12px] bottom-[max(10px,env(safe-area-inset-bottom))] z-20 grid grid-cols-5 rounded-full border border-white/70 bg-surface/75 p-[5px] shadow-[0_10px_30px_rgba(16,18,17,0.14),0_1px_0_rgba(255,255,255,0.8)_inset] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
      >
        {MOBILE_TABS.map((tab) => {
          const on = isActive(pathname, tab.href) && !assistantOpen;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={on ? "page" : undefined}
              className={`flex min-h-[54px] flex-col items-center justify-center gap-[3px] rounded-full transition-[background-color,color,transform] duration-200 ease-out active:scale-[0.96] ${
                on ? "bg-ink text-lime" : "text-[#8b918a]"
              }`}
            >
              <Icon name={tab.icon} size={21} />
              <span className="text-[10.5px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => openAssistant()}
          aria-label={
            notifications.unread
              ? `Open ${assistantName} — ${notifications.unread} new update${notifications.unread === 1 ? "" : "s"}`
              : `Open ${assistantName}`
          }
          title={`Open ${assistantName}`}
          className={`flex min-h-[54px] cursor-pointer flex-col items-center justify-center gap-[3px] rounded-full transition-[background-color,color,transform] duration-200 ease-out active:scale-[0.96] ${
            assistantOpen ? "bg-ink text-lime" : "text-[#8b918a]"
          }`}
        >
          <span
            className={`relative ${
              assistantOpen ? "" : assistantActivity === "replied" ? "reply-bounce" : ""
            }`}
          >
            {!assistantOpen && assistantActivity === "working" ? (
              // Still writing a reply with the chat closed.
              <span
                aria-label="Writing a reply"
                className="typing-dots absolute -top-[6px] -right-[12px] rounded-full border-2 border-surface bg-lime px-[4px] py-[3px] text-ink"
              >
                <span />
                <span />
                <span />
              </span>
            ) : null}
            {!assistantOpen && assistantActivity === "replied" && notifications.unread === 0 ? (
              <span aria-label="New reply" className="absolute -top-[4px] -right-[6px] size-[10px] rounded-full border-2 border-surface bg-lime" />
            ) : null}
            {/* Re-keyed on each new notification so the ring (and badge pop) replays. */}
            <span key={notifications.ring} className={notifications.ring ? "ring-once" : "inline-flex"}>
              <Icon name="bot" size={21} />
            </span>
            {notifications.unread > 0 ? (
              <span
                key={`badge-${notifications.ring}`}
                className={`absolute -top-[6px] -right-[9px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-bad-fg px-[4px] text-[9.5px] font-bold text-white ${notifications.ring ? "pop-once" : ""}`}
              >
                {notifications.unread > 99 ? "99+" : notifications.unread}
              </span>
            ) : null}
          </span>
          <span className="max-w-full truncate px-[2px] text-[10.5px] font-medium">{assistantName}</span>
        </button>
      </nav>
    </div>
  );
}

/**
 * The desktop sidebar's full nav list, reachable on mobile from the hamburger
 * button — the bottom tab bar only fits four of the twelve routes.
 */
function MobileNav({
  pathname,
  user,
  orgName,
  badges,
  isAdmin,
  open,
  onClose,
  onSignOut,
}: {
  pathname: string;
  user: ShellUser;
  orgName: string;
  badges: Record<string, number>;
  isAdmin: boolean;
  open: boolean;
  onClose: () => void;
  onSignOut: () => Promise<void>;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
      hidden={!open}
      className="fixed inset-0 z-50 lg:hidden"
    >
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/30"
      />

      <aside className="absolute top-0 left-0 flex h-full w-[82vw] max-w-[300px] flex-col gap-[14px] overflow-y-auto border-r border-line bg-bg px-4 pt-[18px] pb-4 shadow-[0_0_40px_rgba(16,18,17,0.18)]">
        <div className="flex items-center gap-[8px] px-1 pt-[2px] pb-2">
          <span className="min-w-0 flex-1">
            <BrandLockup />
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-body-soft"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <NavContent pathname={pathname} badges={badges} isAdmin={isAdmin} size="mobile" />

        <div className="mt-auto flex items-center gap-[10px] border-t border-line pt-[14px]">
          <Avatar user={user} size={34} />
          <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
            <span className="truncate text-[13px] font-semibold">{user?.name ?? "No user"}</span>
            <span className="truncate text-[11px] text-muted">
              {orgName}
              {user ? ` · ${user.role[0].toUpperCase()}${user.role.slice(1)}` : ""}
            </span>
          </span>
          <form action={onSignOut}>
            <button
              type="submit"
              aria-label="Sign out"
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-bad-fg"
            >
              <Icon name="logout" size={17} />
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}

function Sidebar({
  pathname,
  user,
  orgName,
  badges,
  isAdmin,
  onSignOut,
}: {
  pathname: string;
  user: ShellUser;
  orgName: string;
  badges: Record<string, number>;
  isAdmin: boolean;
  onSignOut: () => Promise<void>;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen flex-col gap-[14px] border-r border-line bg-bg px-4 pt-[22px] pb-4 lg:flex">
      <div className="flex items-center gap-[8px] px-1 pt-[2px] pb-2">
        <BrandLockup />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavContent pathname={pathname} badges={badges} isAdmin={isAdmin} size="desktop" />
      </div>

      <UserMenu user={user} orgName={orgName} onSignOut={onSignOut} />
    </aside>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function UserMenu({
  user,
  orgName,
  onSignOut,
}: {
  user: ShellUser;
  orgName: string;
  onSignOut: () => Promise<void>;
}) {
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
        <Avatar user={user} size={34} />
        <span className="flex min-w-0 flex-col leading-[1.3]">
          <span className="truncate text-[13px] font-semibold">{user?.name ?? "No user"}</span>
          <span className="truncate text-[11px] text-muted">
            {orgName}
            {user ? ` · ${user.role[0].toUpperCase()}${user.role.slice(1)}` : ""}
          </span>
        </span>
        <Icon
          name="chev"
          size={15}
          className={`shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="absolute right-0 bottom-[calc(100%+8px)] left-0 z-60 flex flex-col gap-[2px] rounded-[16px] border border-line bg-surface p-[7px] shadow-[0_14px_40px_rgba(16,18,17,0.16)]">
          {user ? (
            <div className="flex items-center gap-[10px] px-[11px] py-[9px]">
              <Avatar user={user} size={30} />
              <span className="flex min-w-0 flex-col leading-[1.3]">
                <span className="truncate text-[12.5px] font-semibold">{user.name}</span>
                <span className="truncate text-[11px] text-muted">{user.email}</span>
              </span>
            </div>
          ) : null}
          <div className="mx-[4px] border-t border-line-soft" />
          {USER_MENU.map((item) => {
            const className = `flex min-h-[40px] w-full cursor-pointer items-center gap-[11px] rounded-[12px] px-[11px] text-left text-[13px] ${
              item.danger ? "font-medium text-bad-fg" : "text-[#2a2f29]"
            }`;
            const iconClassName = item.danger ? undefined : "text-body-soft";
            if (item.label === "Sign out") {
              return (
                <form key={item.label} action={onSignOut}>
                  <button type="submit" className={className}>
                    <Icon name={item.icon} size={17} className={iconClassName} />
                    <span className="min-w-0">{item.label}</span>
                  </button>
                </form>
              );
            }
            return (
              <Link key={item.label} href={item.href ?? "#"} onClick={() => setOpen(false)} className={className}>
                <Icon name={item.icon} size={17} className={iconClassName} />
                <span className="min-w-0">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
