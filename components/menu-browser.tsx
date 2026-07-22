"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Star } from "lucide-react";
import type { Category, CategoryType, Product } from "@/types/menu";
import { SearchInput } from "@/components/ui/search-input";
import { MenuCard } from "@/components/menu-card";
import { Reveal } from "@/components/reveal";
import { CategoryTabs, type MenuTab } from "@/components/category-tabs";
import { sortProducts, type SortKey } from "@/lib/menu/sorting";
import { useScrollSpy } from "@/hooks/use-scroll-spy";
import { useOrderRoutes } from "@/store/order-mode";

const sectionId = (type: CategoryType) => `section-${type}`;
const BEST_SELLER_ID = "section-best-seller";

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

  // Remember the browse position so returning from a product (after add-to-cart
  // or the back button) lands the user where they left off instead of at the
  // top. The page remounts on every visit and Next scrolls it to the top in a
  // parent's mount lifecycle; this passive effect runs after that, so the
  // restore wins. Keyed per mode so /menu and /store don't clobber each other.
  //
  // We capture on the way out (a tap anywhere on the list, in the capture phase)
  // rather than via a scroll listener: navigating scrolls the window to the top
  // while this page is briefly still mounted, so a scroll listener would save
  // that 0 and wipe the real position.
  const scrollKey = `menu-scroll:${routes.mode}`;
  const saveScroll = () => {
    sessionStorage.setItem(scrollKey, String(window.scrollY));
  };

  // Only restore when the user actually came back from a product page. The route
  // tracker sets this flag while the user is on the product page; arriving fresh
  // from another tab — e.g. tapping Menu after signing in — leaves it unset, so
  // the menu lands at the top instead of dropping the user mid-list. Captured at
  // mount (lazy init) so it survives the consume below under Strict Mode's
  // double-invoked effects.
  const [cameFromProduct] = useState(
    () =>
      typeof window !== "undefined" &&
      sessionStorage.getItem("menu:from-product") === "1",
  );

  useEffect(() => {
    // Consume the flag so it restores only the round-trip it was set for and
    // doesn't linger to a later visit (e.g. a reload of the menu).
    sessionStorage.removeItem("menu:from-product");
    if (!cameFromProduct) return;
    const saved = Number(sessionStorage.getItem(scrollKey));
    if (saved <= 0) return;
    // The list is fully rendered on mount, but re-assert for a couple of frames
    // in case the navigation's own scroll settles just after us. Cancel any
    // pending frame on unmount so a queued restore can't nudge the next route.
    let frames = 0;
    let rafId = 0;
    let cancelled = false;
    const restore = () => {
      if (cancelled) return;
      window.scrollTo(0, saved);
      if (++frames < 3 && Math.abs(window.scrollY - saved) > 2) {
        rafId = requestAnimationFrame(restore);
      }
    };
    rafId = requestAnimationFrame(restore);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [scrollKey, cameFromProduct]);

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

  const hasBestSellers = bestSellers.length > 0;

  // The Best Seller tab is a virtual first tab (not a real category) that
  // scroll-spies and jumps to the best-seller section at the top.
  const tabs = useMemo<MenuTab[]>(() => {
    const sectionTabs = sections.map((s) => ({
      id: sectionId(s.category.type),
      name: s.category.name,
    }));
    return hasBestSellers
      ? [{ id: BEST_SELLER_ID, name: "Best Seller", highlight: true }, ...sectionTabs]
      : sectionTabs;
  }, [sections, hasBestSellers]);

  const ids = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const { activeId, scrollTo } = useScrollSpy(ids, stickyH);

  return (
    <div className="flex flex-col" onClickCapture={saveScroll}>
      <div ref={stickyRef} className="sticky top-0 z-20 bg-black">
        <header className="px-5 pb-4 pt-3 text-white">
          <div className="flex items-center justify-between">
            <div className="size-9" aria-hidden />
            <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
              MENU
            </h1>
            <div className="size-9" aria-hidden />
          </div>

          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search drinks..."
            aria-label="Search drinks"
            containerClassName="mt-3"
            iconClassName="left-4 text-neutral-400"
            clearClassName="text-neutral-400 hover:bg-neutral-700 hover:text-white"
            className="h-11 rounded-2xl border-0 bg-neutral-800 pl-11 text-base text-white placeholder:text-neutral-400 focus-visible:ring-3 focus-visible:ring-white/30 md:text-sm"
          />
        </header>

        {!searching && tabs.length > 0 && (
          <div className="bg-white px-5 pt-3">
            <CategoryTabs tabs={tabs} activeId={activeId} onSelect={scrollTo} />
          </div>
        )}
      </div>

      {/* pb clears the floating cart bar (which sits above the tab bar) so the
          last drink isn't hidden behind it. */}
      <div className="pb-28">
        {!searching && bestSellers.length > 0 && (
          <section
            id={BEST_SELLER_ID}
            style={{ scrollMarginTop: stickyH }}
            aria-labelledby="best-seller-heading"
            className="px-5 pt-5"
          >
            <Reveal>
              <h2
                id="best-seller-heading"
                className="mb-2 flex items-center gap-2 font-heading text-2xl font-extrabold tracking-tight"
              >
                <Star
                  className="size-6 fill-amber-400 text-amber-400"
                  strokeWidth={0}
                />
                <span className="bg-gradient-to-r from-amber-500 to-amber-700 bg-clip-text text-transparent">
                  Best Seller
                </span>
              </h2>
            </Reveal>
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
              className="min-h-11 appearance-none rounded-lg border border-border bg-white py-1.5 pl-3 pr-8 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
            // No Reveal here: search results must appear instantly. The
            // scroll-reveal observer needs a card to cross its visibility
            // threshold, but with the mobile keyboard open the viewport
            // shrinks and results below the sticky header never cross it,
            // leaving them invisible-but-tappable until the keyboard closes.
            <div className="flex flex-col divide-y divide-border px-5 pt-2">
              {searchResults.map((product) => (
                <MenuCard key={product.id} product={product} />
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
              <Reveal>
                <h2
                  id={`${sectionId(section.category.type)}-heading`}
                  className="mb-2 font-heading text-2xl font-extrabold tracking-tight"
                >
                  {section.category.name}
                </h2>
              </Reveal>
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
