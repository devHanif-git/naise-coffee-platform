"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Product } from "@/types/menu";
import { getProductPricing } from "@/data/discounts";
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
  const [active, setActive] = useState(0);

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    setActive(Math.round(track.scrollLeft / track.clientWidth));
  };

  const scrollTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
  };

  // Auto-advance one slide every 5s, looping back to the first after the last.
  // The interval is keyed on `active`, so any manual scroll or dot tap resets
  // the 5s countdown rather than fighting the user mid-interaction.
  useEffect(() => {
    if (products.length <= 1) return;
    const id = setTimeout(() => {
      scrollTo((active + 1) % products.length);
    }, 5000);
    return () => clearTimeout(id);
  }, [active, products.length]);

  return (
    <section aria-labelledby="best-seller-heading" className="px-5">
      <h2
        id="best-seller-heading"
        className="mb-3 text-sm font-bold uppercase tracking-wide"
      >
        Best Seller
      </h2>

      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="flex snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {products.map((product) => {
            const pricing = getProductPricing(product);
            const onSale = pricing.percentOff > 0;
            return (
              <div key={product.id} className="w-full shrink-0 snap-center p-4">
                <div className="relative flex aspect-[5/4] items-center justify-center overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_50%_36%,_#f4ede4,_#ffffff_72%)] ring-1 ring-black/5">
                  <Image
                    src={images.badge}
                    alt=""
                    width={128}
                    height={128}
                    aria-hidden
                    className="absolute left-2 top-2 z-10 size-24 -rotate-[25deg] rounded-full object-contain drop-shadow-sm"
                  />
                  {onSale && (
                    <span className="absolute right-4 top-4 z-10 inline-flex rounded-full bg-rose-600 px-4 py-1.5 text-base font-bold uppercase tracking-wide text-white shadow-md ring-2 ring-background">
                      {pricing.percentOff}% Off
                    </span>
                  )}
                  <Link
                    href={`/menu/${product.slug}`}
                    aria-label={`View ${product.name}`}
                    className="relative block size-full rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <Image
                      src={product.image}
                      alt={product.name}
                      fill
                      sizes="(max-width: 768px) 90vw, 400px"
                      className="object-contain p-6 transition-transform duration-300 hover:scale-[1.03]"
                    />
                  </Link>
                </div>

                <div className="mt-4 flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-heading text-lg font-bold leading-snug tracking-tight">
                      {product.name}
                    </h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {product.description}
                    </p>
                    {onSale ? (
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-heading text-lg font-bold text-rose-600">
                          {formatPrice(pricing.final)}
                        </span>
                        <span className="text-sm font-medium text-muted-foreground line-through">
                          {formatPrice(pricing.original)}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-3 font-heading text-lg font-bold">
                        {formatPrice(pricing.final)}
                      </p>
                    )}
                  </div>

                  <Link
                    href={`/menu/${product.slug}`}
                    aria-label={`Customize and add ${product.name}`}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform outline-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
                  >
                    <Plus className="size-5" strokeWidth={2.5} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {products.length > 1 && (
          <div className="flex justify-center gap-2 pb-5">
            {products.map((product, i) => (
              <button
                key={product.id}
                type="button"
                onClick={() => scrollTo(i)}
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
