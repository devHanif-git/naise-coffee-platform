"use client";

import { cn } from "@/lib/utils";
import type { Category, CategoryType } from "@/types/menu";

// Category pills that act as scroll-spy anchors: `activeType` is highlighted as
// the user scrolls; tapping one calls `onSelect` to scroll to that section.
// No "All" tab — every pill maps to a real category section.
export function CategoryTabs({
  categories,
  activeType,
  onSelect,
}: {
  categories: Category[];
  activeType: CategoryType;
  onSelect: (type: CategoryType) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Menu categories"
      className="-mx-5 flex gap-2 overflow-x-auto border-b border-border px-5 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {categories.map((category) => {
        const active = category.type === activeType;
        return (
          <button
            key={category.type}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(category.type)}
            className={cn(
              "shrink-0 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "border-black bg-black text-white"
                : "border-border bg-white text-foreground hover:bg-muted",
            )}
          >
            {category.name}
          </button>
        );
      })}
    </div>
  );
}
