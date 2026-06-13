"use client";

import { cn } from "@/lib/utils";
import type { Category, CategoryType } from "@/types/menu";

type Filter = CategoryType | "all";

export function CategoryTabs({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: Filter;
  onChange: (value: Filter) => void;
}) {
  const tabs: { type: Filter; name: string }[] = [
    { type: "all", name: "All" },
    ...categories.map((c) => ({ type: c.type, name: c.name })),
  ];

  return (
    <div
      role="tablist"
      aria-label="Menu categories"
      className="-mx-5 flex gap-2 overflow-x-auto border-b border-border px-5 pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.type === value;
        return (
          <button
            key={tab.type}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.type)}
            className={cn(
              "shrink-0 rounded-full border px-5 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "border-black bg-black text-white"
                : "border-border bg-white text-foreground hover:bg-muted",
            )}
          >
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}

export type { Filter };
