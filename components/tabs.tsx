import Link from "next/link";

/**
 * Tabs that navigate. The selected tab lives in the URL, so the page stays a
 * Server Component and reads its filter straight from `searchParams`.
 */
export function TabLinks<T extends string>({
  options,
  value,
  href,
  label,
}: {
  options: readonly T[];
  value: T;
  href: (option: T) => string;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-[7px]">
      {options.map((option) => {
        const on = option === value;
        return (
          <Link
            key={option}
            href={href(option)}
            role="tab"
            aria-selected={on}
            className={`rounded-full px-[15px] py-[9px] text-[12.5px] font-medium whitespace-nowrap ${
              on ? "bg-ink text-bg" : "border border-line bg-surface text-body"
            }`}
          >
            {option}
          </Link>
        );
      })}
    </div>
  );
}
