import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "@/components/brand-lockup";

/** Shared chrome for /privacy and /terms — simple prose on the same off-white ground as the rest of the site. */
export function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-[22px] px-5 py-[40px] lg:px-8">
      <div className="flex items-center gap-[8px]">
        <Link href="/" aria-label="Clandar home" className="flex shrink-0">
          <BrandLockup />
        </Link>
        <div className="ml-auto flex gap-[14px] text-[12.5px] font-medium">
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          <Link href="/terms" className="underline">
            Terms
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-[6px]">
        <h1 className="m-0 text-[26px] font-bold tracking-[-0.02em]">{title}</h1>
        <span className="text-[12px] text-faint">Last updated: {updated}</span>
      </div>

      <div className="legal-prose flex flex-col gap-[16px] text-[13.5px] leading-[1.65] text-body">
        {children}
      </div>

      <div className="border-t border-line pt-[16px] text-[11.5px] text-faint">
        <Link href="/" className="underline">
          Back to Clandar
        </Link>
      </div>
    </div>
  );
}
