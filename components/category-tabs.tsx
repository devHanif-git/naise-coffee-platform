"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

// A tab maps to a scroll-target element id. `highlight` marks the special
// Best Seller tab, which gets the gold/amber treatment so it stays easy to
// spot and tap from anywhere in the list.
export type MenuTab = {
  id: string;
  name: string;
  highlight?: boolean;
};

// Tab pills that act as scroll-spy anchors: `activeId` is highlighted as the
// user scrolls; tapping one calls `onSelect` to scroll to that section. No
// "All" tab — every pill maps to a real section.
export function CategoryTabs({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: MenuTab[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Menu categories"
      className="-mx-5 flex gap-2 overflow-x-auto border-b border-border px-5 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;

        if (tab.highlight) {
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-gradient-to-r from-amber-400 to-amber-600 px-4 py-1.5 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(245,158,11,0.45)] transition-all outline-none focus-visible:ring-3 focus-visible:ring-amber-300",
                active && "ring-2 ring-amber-300 ring-offset-1",
              )}
            >
              <Star className="size-3.5 fill-current" strokeWidth={0} />
              {tab.name}
            </button>
          );
        }

        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "shrink-0 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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
