import { SmartImage } from "@/components/ui/smart-image";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Product } from "@/types/menu";
import { getProductPricing } from "@/data/discounts";
import { PriceTag } from "@/components/price-tag";

export function MenuCard({ product }: { product: Product }) {
  const pricing = getProductPricing(product);
  const onSale = pricing.percentOff > 0;
  return (
    <div className="flex items-center gap-3 py-4">
      <Link
        href={`/menu/${product.slug}`}
        className="flex flex-1 items-center gap-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-xl"
      >
        <div className="flex shrink-0 flex-col items-center">
          <div className="relative h-24 w-20 overflow-hidden rounded-2xl bg-black p-2">
            <SmartImage
              src={product.image}
              alt={product.name}
              fill
              sizes="80px"
              className="object-contain"
            />
          </div>
          {onSale ? (
            <span className="relative z-10 -mt-2.5 inline-flex rounded-full bg-rose-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-md ring-2 ring-background">
              {pricing.percentOff}% Off
            </span>
          ) : product.isNew ? (
            <span className="relative z-10 -mt-2.5 inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-md ring-2 ring-background">
              New
            </span>
          ) : product.isBestSeller ? (
            <span className="relative z-10 -mt-2.5 inline-flex rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-md ring-2 ring-background">
              Best Seller
            </span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <h3 className="font-heading text-sm font-bold leading-snug tracking-tight">
            {product.name}
          </h3>
          <p className="text-xs text-muted-foreground">{product.description}</p>
          <PriceTag pricing={pricing} className="mt-1" />
        </div>
      </Link>
      <Link
        href={`/menu/${product.slug}`}
        aria-label={`Customize and add ${product.name}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform outline-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
      >
        <Plus className="size-4" strokeWidth={2.5} />
      </Link>
    </div>
  );
}
