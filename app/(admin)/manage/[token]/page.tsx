import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PackageX } from "lucide-react";
import { OrderDetail } from "@/components/order-detail";
import { canManageOrders } from "@/lib/auth/session";
import { getOrderByToken } from "@/lib/orders/store";
import { listCategories, listProducts } from "@/lib/menu/store";
import { getPaymentSettings, getEnabledPaymentMethods } from "@/lib/settings/payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRecipeStrings, mergeRecipe, composeInheritedBase, type RecipeEntry } from "@/lib/menu/recipe";

// Management view is internal — keep it out of search results.
export const metadata: Metadata = {
  title: "Manage Order",
  robots: { index: false, follow: false },
};

export default async function ManageOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Gate first: only staff roles may open an order link. Anyone else (including
  // signed-out visitors who guess/share the link) is sent back to the store.
  if (!(await canManageOrders())) redirect("/");

  const { token } = await params;
  const order = await getOrderByToken(token);

  if (!order) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100 text-muted-foreground">
          <PackageX className="size-8" strokeWidth={2} aria-hidden />
        </div>
        <h1 className="font-heading text-xl font-bold tracking-tight">
          Order not found
        </h1>
        <p className="max-w-[18rem] text-sm leading-relaxed text-muted-foreground">
          This link is invalid or the order is no longer available.
        </p>
      </main>
    );
  }

  // Collect unique product IDs from order items (non-custom drinks only)
  const productIds = [...new Set(
    order.items
      .filter((item) => item.productId)
      .map((item) => item.productId!),
  )];

  // Resolve each product's unified recipe list into ordered display strings for
  // the staff prep sheet (ingredient steps rendered from cost-item templates
  // with grams filled; custom + free steps as written).
  const recipeMap = new Map<string, string[]>();
  if (productIds.length > 0) {
    const db = createAdminClient();
    const [prods, items] = await Promise.all([
      db.from("products").select("id, recipe, category_id").in("id", productIds),
      db.from("cost_items").select("id, is_always_included, is_archived, prep_template"),
    ]);
    // Merge each product's recipe with its inherited base (global
    // always-included steps like ice + its category base) so the prep sheet
    // lists inherited steps plus drink-specific ones, once each.
    const categoryIds = [
      ...new Set(
        (prods.data ?? [])
          .map((p) => p.category_id)
          .filter((id): id is string => !!id),
      ),
    ];
    const cats = categoryIds.length
      ? await db.from("categories").select("id, recipe").in("id", categoryIds)
      : { data: [] };
    const categoryRecipeById = new Map(
      (cats.data ?? []).map((c) => [
        c.id,
        ((c.recipe as unknown) as RecipeEntry[] | null) ?? null,
      ]),
    );
    const costItems = (items.data ?? []).map((c) => ({
      id: c.id,
      alwaysIncluded: c.is_always_included,
      isArchived: c.is_archived,
      prepTemplate: c.prep_template,
    }));
    const templateById = new Map(
      (items.data ?? []).map((c) => [c.id, c.prep_template]),
    );
    for (const p of prods.data ?? []) {
      const inheritedBase = composeInheritedBase(
        costItems,
        p.category_id ? categoryRecipeById.get(p.category_id) ?? null : null,
      );
      const merged = mergeRecipe(
        inheritedBase,
        ((p.recipe as unknown) as RecipeEntry[] | null) ?? null,
      );
      const strings = resolveRecipeStrings(merged, templateById);
      if (strings.length > 0) recipeMap.set(p.id, strings);
    }
  }

  // Methods staff can switch this order to (manager-gated edit). Mirrors what
  // the storefront offers, so disabling a method in settings removes it here too.
  const payments = await getPaymentSettings();
  const paymentOptions = getEnabledPaymentMethods(payments).map((m) => ({
    id: m.id,
    name: m.name,
  }));

  // Catalog for the swap picker: the same menu the customer sees, so staff pick
  // from live, correctly-priced drinks.
  const [categories, products] = await Promise.all([
    listCategories(),
    listProducts(),
  ]);

  return (
    <OrderDetail
      order={order}
      recipeMap={recipeMap}
      paymentOptions={paymentOptions}
      categories={categories}
      products={products}
    />
  );
}
