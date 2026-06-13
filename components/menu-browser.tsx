"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronLeft, ChevronDown } from "lucide-react";
import type { Category, Product } from "@/types/menu";
import { Input } from "@/components/ui/input";
import { MenuCard } from "@/components/menu-card";
import { Reveal } from "@/components/reveal";
import { CategoryTabs, type Filter } from "@/components/category-tabs";
import { getBasePrice } from "@/data/menu";

type SortKey = "popular" | "price-asc" | "price-desc";

export function MenuBrowser({
  categories,
  products,
}: {
  categories: Category[];
  products: Product[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("popular");

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
      <header className="sticky top-0 z-20 bg-black px-5 pb-5 pt-4 text-white">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            aria-label="Go back"
            className="flex size-8 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-white/40"
          >
            <ChevronLeft className="size-6" />
          </Link>
          <h1 className="font-heading text-lg font-semibold tracking-[0.25em]">
            MENU
          </h1>
          <div className="size-8" aria-hidden />
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-neutral-400" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search drinks..."
            aria-label="Search drinks"
            className="h-12 rounded-2xl border-0 bg-neutral-800 pl-12 text-base text-white placeholder:text-neutral-400 focus-visible:ring-3 focus-visible:ring-white/30"
          />
        </div>
      </header>

      <div className="flex flex-col gap-4 px-5 py-5">
        <CategoryTabs
          categories={categories}
          value={filter}
          onChange={setFilter}
        />

        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sort by
          </span>
          <div className="relative">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort drinks"
              className="appearance-none rounded-lg border border-border bg-white py-2 pl-4 pr-9 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="popular">Popular</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
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
