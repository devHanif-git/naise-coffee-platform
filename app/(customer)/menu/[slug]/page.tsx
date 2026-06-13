import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Star } from "lucide-react";
import { getBasePrice, getProduct, products } from "@/data/menu";
import { formatPrice } from "@/lib/format";
import { ProductCustomizer } from "@/components/product-customizer";

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(
  props: PageProps<"/menu/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const product = getProduct(slug);

  if (!product) {
    return { title: "Not found" };
  }

  return {
    title: product.name,
    description: product.description,
    openGraph: {
      title: `${product.name} · Naise Coffee`,
      description: product.description,
      type: "website",
      images: [{ url: product.image }],
    },
  };
}

export default async function ProductPage(props: PageProps<"/menu/[slug]">) {
  const { slug } = await props.params;
  const product = getProduct(slug);

  if (!product) {
    notFound();
  }

  const basePrice = getBasePrice(product);

  return (
    <article className="flex flex-col">
      <div className="relative aspect-square w-full bg-black naise-pop">
        <Link
          href="/menu"
          aria-label="Go back"
          className="absolute left-5 top-4 z-10 flex size-8 items-center justify-center rounded-full text-white outline-none focus-visible:ring-3 focus-visible:ring-white/40"
        >
          <ChevronLeft className="size-6" />
        </Link>

        {(product.isBestSeller || product.isNew) && (
          <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5">
            {product.isBestSeller && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-black/20">
                <Star className="size-3.5 fill-black" strokeWidth={0} aria-hidden />
                Best Seller
              </span>
            )}
            {product.isNew && (
              <span className="inline-flex items-center rounded-full border border-white/40 bg-black/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
                New
              </span>
            )}
          </div>
        )}

        <Image
          src={product.image}
          alt={product.name}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 448px"
          className="object-contain p-6"
        />
      </div>

      <div className="flex flex-col gap-5 px-5 pt-6">
        <header
          className="flex flex-col gap-2 naise-rise"
          style={{ animationDelay: "120ms" }}
        >
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {product.name}
          </h1>
          <p className="text-sm text-muted-foreground">{product.description}</p>
          <p className="mt-1 text-lg font-bold">{formatPrice(basePrice)}</p>
        </header>

        <hr className="border-border naise-rise" style={{ animationDelay: "180ms" }} />

        <ProductCustomizer product={product} />
      </div>
    </article>
  );
}
