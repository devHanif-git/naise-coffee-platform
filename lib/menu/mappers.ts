import type { Category, Product, Addon, ProductSize } from "@/types/menu";
import { images } from "@/constants/images";
import type { Database } from "@/types/database";

type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type VariantRow = Database["public"]["Tables"]["product_variants"]["Row"];
type AddonRow = Database["public"]["Tables"]["addons"]["Row"];
type CategoryAddonRow = Database["public"]["Tables"]["category_addons"]["Row"];
type ProductAddonRow = Database["public"]["Tables"]["product_addons"]["Row"];

export function mapCategory(row: CategoryRow): Category {
  return { type: row.slug, name: row.name };
}

function mapVariant(row: VariantRow): ProductSize {
  return { id: row.id, name: row.name, price: row.price };
}

function mapAddon(row: AddonRow): Addon {
  return { id: row.id, name: row.name, price: row.price };
}

// Effective add-ons for one product: category defaults, minus per-product
// "remove" overrides, plus per-product "add" overrides. Ordered by the override
// sort_order when present, else the category sort_order. Archived add-ons drop
// out (not in the addon map).
export function resolveAddons(
  productId: string,
  categoryId: string,
  addonsById: Map<string, Addon>,
  categoryAddons: CategoryAddonRow[],
  productAddons: ProductAddonRow[],
): Addon[] {
  const removed = new Set(
    productAddons.filter((r) => r.product_id === productId && r.mode === "remove").map((r) => r.addon_id),
  );
  const ordered: { id: string; sort: number }[] = [];
  for (const ca of categoryAddons) {
    if (ca.category_id !== categoryId) continue;
    if (removed.has(ca.addon_id)) continue;
    ordered.push({ id: ca.addon_id, sort: ca.sort_order });
  }
  for (const pa of productAddons) {
    if (pa.product_id !== productId || pa.mode !== "add") continue;
    if (ordered.some((o) => o.id === pa.addon_id)) continue;
    ordered.push({ id: pa.addon_id, sort: 1000 + pa.sort_order });
  }
  return ordered
    .sort((a, b) => a.sort - b.sort)
    .map((o) => addonsById.get(o.id))
    .filter((a): a is Addon => Boolean(a));
}

// Assemble full Product shapes from the raw row sets fetched by the store.
export function buildProducts(opts: {
  productRows: ProductRow[];
  variantRows: VariantRow[];
  addonRows: AddonRow[];
  categoryRows: CategoryRow[];
  categoryAddonRows: CategoryAddonRow[];
  productAddonRows: ProductAddonRow[];
}): Product[] {
  const { productRows, variantRows, addonRows, categoryRows, categoryAddonRows, productAddonRows } = opts;
  const addonsById = new Map<string, Addon>(addonRows.map((a) => [a.id, mapAddon(a)]));
  const categoryById = new Map<string, CategoryRow>(categoryRows.map((c) => [c.id, c]));

  return productRows.map((p) => {
    const category = categoryById.get(p.category_id);
    const sizes = variantRows
      .filter((v) => v.product_id === p.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(mapVariant);
    const addons = resolveAddons(p.id, p.category_id, addonsById, categoryAddonRows, productAddonRows);
    const product: Product = {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      category: category?.slug ?? "",
      image: p.image_url ?? images.coffeeWithLogo,
      addons,
      maxAddons: p.max_addons ?? category?.max_addons ?? addons.length,
      isBestSeller: p.is_best_seller || undefined,
      isNew: p.is_new || undefined,
      isFeatured: p.is_featured || undefined,
    };
    if (sizes.length > 0) product.sizes = sizes;
    else product.price = p.base_price ?? 0;
    return product;
  });
}
