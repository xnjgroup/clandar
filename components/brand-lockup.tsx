import { BrandMark } from "@/components/brand-mark";

/**
 * Logo + name, the same height: "Clandar" at 28px (Instrument Sans capitals are 0.72em → 20.16px)
 * beside a 20px mark. With a 28px line box the capitals run from y 3.92 to 24.08, so the mark sits
 * 4px down — on whole pixels, level with the capitals' top and baseline.
 */
export function BrandLockup() {
  return (
    <span className="inline-flex h-[28px] items-start gap-[9px] text-[28px] leading-[28px] font-medium tracking-[-0.02em]">
      <BrandMark size={20} className="mt-[4px]" />
      Clandar
    </span>
  );
}
