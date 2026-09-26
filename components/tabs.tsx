"use client";

export function TabList<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-[7px]">
      {options.map((option) => {
        const on = option === value;
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(option)}
            className={`cursor-pointer rounded-full px-[15px] py-[9px] text-[12.5px] font-medium whitespace-nowrap ${
              on ? "bg-ink text-bg" : "border border-line bg-surface text-body"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
