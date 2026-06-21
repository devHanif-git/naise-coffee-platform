import { notFound } from "next/navigation";
import { SmartImage } from "@/components/ui/smart-image";
import { ProductCustomizer } from "@/components/product-customizer";
import { getProductBySlug } from "@/lib/menu/store";

export const dynamic = "force-dynamic";

export default async function StoreProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  return (
    <article className="flex flex-col p-5">
      <div className="relative mx-auto mb-4 h-56 w-44 overflow-hidden rounded-3xl bg-black p-3">
        <SmartImage src={product.image} alt={product.name} fill sizes="176px" className="object-contain" />
      </div>
      <h1 className="font-heading text-xl font-bold">{product.name}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{product.description}</p>
      {/* Empty catalog => reward mode can never engage in the kiosk. */}
      <ProductCustomizer product={product} catalog={[]} />
    </article>
  );
}
