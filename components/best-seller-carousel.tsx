"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { SmartImage } from "@/components/ui/smart-image";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Product } from "@/types/menu";
import { getProductPricing } from "@/lib/promotions/pricing";
import { formatPrice } from "@/lib/format";
import { images } from "@/constants/images";
import { cn } from "@/lib/utils";

// Horizontal scroll-snap carousel of best-selling drinks. One product per
// slide. Each drink sits on a soft warm "stage" (a radial gradient pedestal) so
// the photo reads as an intentional product shot rather than floating in empty
// space. Pagination dots are tappable and jump to their slide. The "+" and the
// image route to the product page so size/add-ons are chosen before the cart,
// matching MenuCard.
export function BestSellerCarousel({ products }: { products: Product[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(0);

  // Clones on both ends turn native scroll-snap into a bidirectional infinite
  // loop. A copy of the LAST product sits before the first, and a copy of the
  // FIRST product sits after the last. Swiping past either edge lands on an
  // identical-looking clone; once the scroll settles we jump instantly (no
  // animation) to the matching real slide, so the wrap is invisible. Slide
  // indices: 0 = leading clone (looks like last), 1..n = real products,
  // n+1 = trailing clone (looks like first).
  const hasLoop = products.length > 1;
  const slides = hasLoop
    ? [products[products.length - 1], ...products, products[0]]
    : products;

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);

    if (!hasLoop) {
      setActive(index);
      return;
    }

    // Map the raw slide index (offset by the leading clone) to a product index.
    setActive((index - 1 + products.length) % products.length);

    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (index === 0) {
      // Leading clone: jump forward to the real last slide.
      resetTimer.current = setTimeout(() => {
        track.scrollTo({ left: products.length * track.clientWidth, behavior: "auto" });
      }, 150);
    } else if (index === products.length + 1) {
      // Trailing clone: jump back to the real first slide.
      resetTimer.current = setTimeout(() => {
        track.scrollTo({ left: track.clientWidth, behavior: "auto" });
      }, 150);
    }
  };

  // `index` is a position in `slides` (raw, clone-inclusive).
  const scrollTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
  };

  // Start on the first real slide (just past the leading clone) so a backward
  // swipe has the clone to land on.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || !hasLoop) return;
    track.scrollLeft = track.clientWidth;
  }, [hasLoop]);

  // Auto-advance one slide every 5s. From the last real slide it advances onto
  // the clone, which then resets to the start — a continuous forward loop.
  // The interval is keyed on `active`, so any manual scroll or dot tap resets
  // the 5s countdown rather than fighting the user mid-interaction.
  useEffect(() => {
    if (products.length <= 1) return;
    const id = setTimeout(() => {
      const track = trackRef.current;
      if (!track) return;
      const current = Math.round(track.scrollLeft / track.clientWidth);
      scrollTo(current + 1);
    }, 5000);
    return () => clearTimeout(id);
  }, [active, products.length]);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  return (
    <section aria-labelledby="best-seller-heading" className="px-5">
      <h2
        id="best-seller-heading"
        className="mb-2.5 text-xs font-bold uppercase tracking-wide"
      >
        Best Seller
      </h2>

      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="flex snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((product, slideIndex) => {
            const pricing = getProductPricing(product);
            const onSale = pricing.percentOff > 0;
            return (
              <div
                key={`${product.id}-${slideIndex}`}
                inert={
                  hasLoop && (slideIndex === 0 || slideIndex === slides.length - 1)
                }
                className="w-full shrink-0 snap-center p-3"
              >
                <div className="relative flex aspect-[5/4] items-center justify-center overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_50%_36%,_#f4ede4,_#ffffff_72%)] ring-1 ring-black/5">
                  <Image
                    src={images.badge}
                    alt=""
                    width={128}
                    height={128}
                    aria-hidden
                    className="absolute left-2 top-2 z-10 size-20 -rotate-[25deg] rounded-full object-contain drop-shadow-sm"
                  />
                  {onSale && (
                    <span className="absolute right-4 top-4 z-10 inline-flex rounded-full bg-rose-600 px-3 py-1 text-sm font-bold uppercase tracking-wide text-white shadow-md ring-2 ring-background">
                      {pricing.percentOff}% Off
                    </span>
                  )}
                  <Link
                    href={`/menu/${product.slug}`}
                    aria-label={`View ${product.name}`}
                    className="relative block size-full rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <SmartImage
                      src={product.image}
                      alt={product.name}
                      fill
                      sizes="(max-width: 768px) 90vw, 400px"
                      className="object-contain p-5 transition-transform duration-300 hover:scale-[1.03]"
                    />
                  </Link>
                </div>

                <div className="mt-3 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-heading text-base font-bold leading-snug tracking-tight">
                      {product.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {product.description}
                    </p>
                    {onSale ? (
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="font-heading text-base font-bold text-rose-600">
                          {formatPrice(pricing.final)}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground line-through">
                          {formatPrice(pricing.original)}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-2 font-heading text-base font-bold">
                        {formatPrice(pricing.final)}
                      </p>
                    )}
                  </div>

                  <Link
                    href={`/menu/${product.slug}`}
                    aria-label={`Customize and add ${product.name}`}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform outline-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
                  >
                    <Plus className="size-4" strokeWidth={2.5} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {products.length > 1 && (
          <div className="flex justify-center gap-2 pb-4">
            {products.map((product, i) => (
              <button
                key={product.id}
                type="button"
                onClick={() => scrollTo(i + 1)}
                aria-label={`Go to ${product.name}`}
                aria-current={i === active ? "true" : undefined}
                className={cn(
                  "h-2 rounded-full outline-none transition-all duration-300 focus-visible:ring-3 focus-visible:ring-ring/50",
                  i === active
                    ? "w-6 bg-black"
                    : "w-2 bg-neutral-300 hover:bg-neutral-400",
                )}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
