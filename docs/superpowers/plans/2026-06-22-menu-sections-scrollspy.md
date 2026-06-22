# Menu Sections, Scroll-Spy Tabs & Best-Seller Strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape `/menu` into one continuously-scrolling page with category sections, scroll-spy tabs (no "All"), and a best-seller strip on top.

**Architecture:** A pure `sortProducts` helper decides ordering; a `useScrollSpy` hook drives the active tab via `IntersectionObserver`; `MenuBrowser` composes the sticky header + tabs + best-seller strip + per-category sections, reusing the existing `MenuCard` row. `category-tabs.tsx` switches from a filter control to a scroll selector.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind v4. No test runner in this repo — verification is `npm run lint`, `npm run build` (Next typecheck), and a manual browser checklist.

## Global Constraints

- TypeScript strict, **no `any`** (AGENTS.md).
- Mobile-first; match existing design tokens — section headings use `text-xs font-bold uppercase tracking-wide` (same as the existing Best Seller heading).
- Reuse `MenuCard`; do **not** create a new card style.
- Static styles use Tailwind utilities/arbitrary values; inline `style` is allowed **only** for runtime-computed values (the measured sticky height → `scrollMarginTop`).
- Do not add libraries. Do not delete `components/best-seller-carousel.tsx`.
- The menu is shared by customer + kiosk via `useOrderRoutes`; `MenuCard` already routes correctly — do not hardcode `/menu/...`.
- Prices come from `getBasePrice(product)` (`lib/menu/pricing.ts`), in sen.

---

### Task 1: `sortProducts` ordering helper

**Files:**
- Create: `lib/menu/sorting.ts`

**Interfaces:**
- Consumes: `getBasePrice(product: Product): number` from `@/lib/menu/pricing`; `Product` from `@/types/menu`.
- Produces: `type SortKey = "recommended" | "price-asc" | "price-desc"` and `sortProducts(products: Product[], sort: SortKey): Product[]` (pure, non-mutating, stable).

- [ ] **Step 1: Create the helper**

`lib/menu/sorting.ts`:

```ts
import type { Product } from "@/types/menu";
import { getBasePrice } from "@/lib/menu/pricing";

export type SortKey = "recommended" | "price-asc" | "price-desc";

// Orders products for display. "recommended" surfaces new drinks first, then
// best sellers, then everything else — each group ordered by lowest price.
// The explicit price sorts ignore that grouping and sort purely by price.
// Pure and non-mutating; Array.sort is stable in modern JS so equal items keep
// their incoming order.
export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const copy = [...products];
  if (sort === "price-asc") {
    return copy.sort((a, b) => getBasePrice(a) - getBasePrice(b));
  }
  if (sort === "price-desc") {
    return copy.sort((a, b) => getBasePrice(b) - getBasePrice(a));
  }
  const rank = (p: Product) => (p.isNew ? 0 : p.isBestSeller ? 1 : 2);
  return copy.sort(
    (a, b) => rank(a) - rank(b) || getBasePrice(a) - getBasePrice(b),
  );
}
```

- [ ] **Step 2: Lint the new file**

Run: `npm run lint`
Expected: PASS (no errors for `lib/menu/sorting.ts`).

- [ ] **Step 3: Commit**

```bash
git add lib/menu/sorting.ts
git commit -m "feat(menu): add sortProducts ordering helper"
```

---

### Task 2: `useScrollSpy` hook

**Files:**
- Create: `hooks/use-scroll-spy.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useScrollSpy(ids: string[], offset: number): { activeId: string; scrollTo: (id: string) => void }`. `ids` is the ordered list of section element ids; `offset` is the sticky-header height in px. Caller MUST pass a memoized `ids` array (stable reference) to avoid re-subscribing every render.

- [ ] **Step 1: Create the hook**

`hooks/use-scroll-spy.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Tracks which section is under the sticky header and scrolls to a section on
// demand. A thin trigger band sits just below the sticky header (top inset =
// `offset`); the topmost section in `ids` order that is inside the band is the
// active one. Before any section reaches the band (e.g. while the best-seller
// strip is on screen), the first id stays active — no dead state.
export function useScrollSpy(ids: string[], offset: number) {
  const [activeId, setActiveId] = useState<string>(ids[0] ?? "");
  const visible = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (ids.length === 0) return;
    visible.current = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.current.add(entry.target.id);
          else visible.current.delete(entry.target.id);
        }
        const topmost = ids.find((id) => visible.current.has(id));
        if (topmost) setActiveId(topmost);
      },
      // Band: from `offset` px below the viewport top down to the top 25% of the
      // viewport (large negative bottom inset), so usually one heading qualifies.
      { rootMargin: `-${offset}px 0px -75% 0px`, threshold: 0 },
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids, offset]);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    setActiveId(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return { activeId, scrollTo };
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS for `hooks/use-scroll-spy.ts`.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-scroll-spy.ts
git commit -m "feat(menu): add useScrollSpy hook for section tabs"
```

---

### Task 3: Rework `CategoryTabs` + `MenuBrowser` into the sectioned layout

These ship together: `CategoryTabs`'s prop interface changes and `MenuBrowser` is its only consumer, so the build is only green once both are updated.

**Files:**
- Modify: `components/category-tabs.tsx` (full rewrite of the component body + props; drop the `Filter` type)
- Modify: `components/menu-browser.tsx` (rework)
- Verify no other importer of the removed `Filter` type.

**Interfaces:**
- Consumes: `sortProducts`, `SortKey` (Task 1); `useScrollSpy` (Task 2); `MenuCard`, `Reveal`, `Input`, `useOrderRoutes`, `Category`, `Product`, `CategoryType` (existing).
- Produces: updated `CategoryTabs` props `{ categories: Category[]; activeType: CategoryType; onSelect: (type: CategoryType) => void }`.

- [ ] **Step 1: Confirm `Filter` has no other importers**

Run: `git grep -n "type Filter" -- components app lib hooks store`
Expected: matches only in `components/category-tabs.tsx` and `components/menu-browser.tsx`. If anything else imports it, stop and reassess.

- [ ] **Step 2: Rewrite `components/category-tabs.tsx`**

Replace the entire file with:

```tsx
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
```

(The `export type { Filter }` line is intentionally removed.)

- [ ] **Step 3: Rewrite `components/menu-browser.tsx`**

Replace the entire file with:

```tsx
"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, ChevronLeft, ChevronDown } from "lucide-react";
import type { Category, CategoryType, Product } from "@/types/menu";
import { Input } from "@/components/ui/input";
import { MenuCard } from "@/components/menu-card";
import { Reveal } from "@/components/reveal";
import { CategoryTabs } from "@/components/category-tabs";
import { sortProducts, type SortKey } from "@/lib/menu/sorting";
import { useScrollSpy } from "@/hooks/use-scroll-spy";
import { useOrderRoutes } from "@/store/order-mode";

const sectionId = (type: CategoryType) => `section-${type}`;

export function MenuBrowser({
  categories,
  products,
}: {
  categories: Category[];
  products: Product[];
}) {
  const routes = useOrderRoutes();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recommended");

  // Measure the sticky header so section anchors clear it and the scroll-spy
  // trigger line sits just below it. Runtime value → inline scrollMarginTop.
  const stickyRef = useRef<HTMLDivElement>(null);
  const [stickyH, setStickyH] = useState(0);
  useLayoutEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const update = () => setStickyH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const q = query.trim().toLowerCase();
  const searching = q !== "";

  // Category sections that actually have products, each internally ordered.
  const sections = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          items: sortProducts(
            products.filter((p) => p.category === category.type),
            sort,
          ),
        }))
        .filter((s) => s.items.length > 0),
    [categories, products, sort],
  );

  const bestSellers = useMemo(
    () => sortProducts(products.filter((p) => p.isBestSeller), sort),
    [products, sort],
  );

  const searchResults = useMemo(() => {
    if (!searching) return [];
    return sortProducts(
      products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q),
      ),
      sort,
    );
  }, [products, q, searching, sort]);

  const tabCategories = useMemo(
    () => sections.map((s) => s.category),
    [sections],
  );
  const ids = useMemo(
    () => sections.map((s) => sectionId(s.category.type)),
    [sections],
  );
  const { activeId, scrollTo } = useScrollSpy(ids, stickyH);
  const activeType =
    sections.find((s) => sectionId(s.category.type) === activeId)?.category
      .type ??
    sections[0]?.category.type ??
    "";

  return (
    <div className="flex flex-col">
      <div ref={stickyRef} className="sticky top-0 z-20 bg-black">
        <header className="px-5 pb-4 pt-3 text-white">
          <div className="flex items-center justify-between">
            {routes.mode === "customer" ? (
              <Link
                href="/"
                aria-label="Go back"
                className="flex size-9 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-white/40"
              >
                <ChevronLeft className="size-6" />
              </Link>
            ) : (
              <div className="size-9" aria-hidden />
            )}
            <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
              MENU
            </h1>
            <div className="size-9" aria-hidden />
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search drinks..."
              aria-label="Search drinks"
              className="h-11 rounded-2xl border-0 bg-neutral-800 pl-11 text-sm text-white placeholder:text-neutral-400 focus-visible:ring-3 focus-visible:ring-white/30"
            />
          </div>
        </header>

        {!searching && tabCategories.length > 0 && (
          <div className="bg-white px-5 pt-3">
            <CategoryTabs
              categories={tabCategories}
              activeType={activeType}
              onSelect={(type) => scrollTo(sectionId(type))}
            />
          </div>
        )}
      </div>

      {/* pb clears the floating cart bar (which sits above the tab bar) so the
          last drink isn't hidden behind it. */}
      <div className="pb-28">
        {!searching && bestSellers.length > 0 && (
          <section
            aria-labelledby="best-seller-heading"
            className="px-5 pt-4"
          >
            <h2
              id="best-seller-heading"
              className="mb-1 text-xs font-bold uppercase tracking-wide"
            >
              Best Seller
            </h2>
            <div className="flex flex-col divide-y divide-border">
              {bestSellers.map((product, i) => (
                <Reveal key={product.id} delay={Math.min(i, 5) * 70}>
                  <MenuCard product={product} />
                </Reveal>
              ))}
            </div>
          </section>
        )}

        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Sort by
          </span>
          <div className="relative">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort drinks"
              className="appearance-none rounded-lg border border-border bg-white py-1.5 pl-3 pr-8 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="recommended">Recommended</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {searching ? (
          searchResults.length === 0 ? (
            <p className="px-5 py-16 text-center text-xs text-muted-foreground">
              No drinks match your search.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border px-5 pt-2">
              {searchResults.map((product, i) => (
                <Reveal key={product.id} delay={Math.min(i, 5) * 70}>
                  <MenuCard product={product} />
                </Reveal>
              ))}
            </div>
          )
        ) : (
          sections.map((section) => (
            <section
              key={section.category.type}
              id={sectionId(section.category.type)}
              style={{ scrollMarginTop: stickyH }}
              aria-labelledby={`${sectionId(section.category.type)}-heading`}
              className="px-5 pt-5"
            >
              <h2
                id={`${sectionId(section.category.type)}-heading`}
                className="mb-1 text-xs font-bold uppercase tracking-wide"
              >
                {section.category.name}
              </h2>
              <div className="flex flex-col divide-y divide-border">
                {section.items.map((product, i) => (
                  <Reveal key={product.id} delay={Math.min(i, 5) * 70}>
                    <MenuCard product={product} />
                  </Reveal>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: PASS. If ESLint flags unused `Category` import, confirm it is used in the `MenuBrowser` props type (it is) — no change needed.

- [ ] **Step 5: Typecheck via build**

Run: `npm run build`
Expected: Compiles with no type errors. (First build may be slow.)

- [ ] **Step 6: Commit**

```bash
git add components/category-tabs.tsx components/menu-browser.tsx
git commit -m "feat(menu): sectioned menu with scroll-spy tabs and best-seller strip"
```

---

### Task 4: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`, open `/menu`.

- [ ] **Step 2: Walk the checklist**

- No "All" tab; tabs show only categories that have drinks.
- A "Best Seller" strip appears above "Sort by", listing best-seller drinks; the same drinks still appear in their own category section below.
- Each category renders a heading (e.g. COFFEE, NON COFFEE, MATCHA) above its drinks.
- Scrolling highlights the tab of the section currently under the sticky header.
- Tapping a tab smooth-scrolls so the section heading lands just below the sticky header (not hidden under it).
- Default order within a section is new → best seller → cheapest first; switching "Sort by" to Price Low/High re-sorts purely by price.
- Typing in search hides the tabs + best-seller strip + section headings and shows a flat result list; clearing search restores sections.
- Check kiosk mode (`mode !== "customer"`): back chevron hidden, "+" / card taps route correctly.

- [ ] **Step 3: Done**

No commit (verification only). Report results; if any check fails, fix in the relevant task's file and re-run lint/build.

---

## Self-Review

**Spec coverage:**
- Remove "All" → Task 3 (CategoryTabs rewrite, no "All").
- Section headings per category → Task 3 (`<section>` + `<h2>`).
- Scroll-spy highlight on scroll → Task 2 + Task 3 wiring.
- Tap tab → scroll to section (clearing sticky header) → Task 2 `scrollTo` + `scrollMarginTop`.
- Best-seller strip above Sort by → Task 3.
- Default order new → best seller → price; price sorts override → Task 1 + Task 3.
- Search collapses to flat list → Task 3.
- Design tokens / reuse MenuCard → Task 3.

**Placeholder scan:** none — all code is concrete.

**Type consistency:** `SortKey` defined in Task 1 and imported in Task 3; `useScrollSpy(ids, offset)` signature in Task 2 matches the Task 3 call; `CategoryTabs` props `{ categories, activeType, onSelect }` defined in Task 3 Step 2 and used in Step 3; `sectionId` helper used consistently for element ids and `scrollTo`.
