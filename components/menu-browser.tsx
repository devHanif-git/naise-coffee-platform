"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

  // When searching, keep the result list anchored at the top so the user reads
  // matches from the start rather than from wherever they had scrolled to.
  useEffect(() => {
    if (searching) window.scrollTo({ top: 0 });
  }, [q, searching]);

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
          <section aria-labelledby="best-seller-heading" className="px-5 pt-5">
            <h2
              id="best-seller-heading"
              className="mb-2 font-heading text-2xl font-extrabold tracking-tight"
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
              className="px-5 pt-6"
            >
              <h2
                id={`${sectionId(section.category.type)}-heading`}
                className="mb-2 font-heading text-2xl font-extrabold tracking-tight"
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
