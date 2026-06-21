"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronLeft, ChevronDown } from "lucide-react";
import type { Category, Product } from "@/types/menu";
import { Input } from "@/components/ui/input";
import { MenuCard } from "@/components/menu-card";
import { Reveal } from "@/components/reveal";
import { CategoryTabs, type Filter } from "@/components/category-tabs";
import { getBasePrice } from "@/lib/menu/pricing";
import { useOrderRoutes } from "@/store/order-mode";

type SortKey = "popular" | "price-asc" | "price-desc";

export function MenuBrowser({
  categories,
  products,
}: {
  categories: Category[];
  products: Product[];
}) {
  const routes = useOrderRoutes();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("popular");

  const handleFilterChange = (next: Filter) => {
    setFilter(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = products.filter((p) => {
      const matchesCategory = filter === "all" || p.category === filter;
      const matchesQuery =
        q === "" ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });

    if (sort === "price-asc") {
      return [...filtered].sort((a, b) => getBasePrice(a) - getBasePrice(b));
    }
    if (sort === "price-desc") {
      return [...filtered].sort((a, b) => getBasePrice(b) - getBasePrice(a));
    }
    return filtered;
  }, [products, filter, query, sort]);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-20 bg-black">
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

        <div className="bg-white px-5 pt-3">
          <CategoryTabs
            categories={categories}
            value={filter}
            onChange={handleFilterChange}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center justify-between">
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
              <option value="popular">Popular</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-16 text-center text-xs text-muted-foreground">
            No drinks match your search.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {visible.map((product, i) => (
              <Reveal key={product.id} delay={Math.min(i, 5) * 70}>
                <MenuCard product={product} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
