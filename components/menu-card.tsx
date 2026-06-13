import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Product } from "@/types/menu";
import { formatPrice } from "@/lib/format";
import { getBasePrice } from "@/data/menu";

export function MenuCard({ product }: { product: Product }) {
  return (
    <div className="flex items-center gap-4 py-5">
      <Link
        href={`/menu/${product.slug}`}
        className="flex flex-1 items-center gap-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-xl"
      >
        <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-2xl bg-black p-2">
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="96px"
            className="object-contain"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <h3 className="font-heading text-base font-bold leading-snug tracking-tight">
            {product.name}
          </h3>
          <p className="text-sm text-muted-foreground">{product.description}</p>
          <span className="mt-1 inline-flex w-fit rounded-full bg-black px-3 py-1 text-sm font-bold text-white">
            {formatPrice(getBasePrice(product))}
          </span>
        </div>
      </Link>
      <Link
        href={`/menu/${product.slug}`}
        aria-label={`Customize and add ${product.name}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform outline-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
      >
        <Plus className="size-4" strokeWidth={2.5} />
      </Link>
    </div>
  );
}
