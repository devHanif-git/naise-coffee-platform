"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/session";
import { CATALOG_TAG } from "@/lib/menu/store";
import type { ProductFormData } from "@/lib/menu/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

type Flag = "best_seller" | "new" | "featured";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Revalidate the CMS list and the storefront surfaces a menu change affects.
function revalidateStorefront() {
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  revalidatePath("/menu/[slug]", "page");
  revalidatePath("/home");
  // Invalidate the cached storefront catalogue. Price-authoritative paths (cart
  // re-price, checkout) read fresh via listProductsFresh(), so stale-while-
  // revalidate ("max") is fine here — the menu can refresh in the background.
  revalidateTag(CATALOG_TAG, "max");
}

export async function setAvailability(
  id: string,
  value: boolean,
): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("products").update({ is_available: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateStorefront();
  return { ok: true };
}

export async function setFlag(
  id: string,
  flag: Flag,
  value: boolean,
): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const patch =
    flag === "best_seller"
      ? { is_best_seller: value }
      : flag === "new"
        ? { is_new: value }
        : { is_featured: value };
  const { error } = await db.from("products").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateStorefront();
  return { ok: true };
}

export async function setArchived(
  id: string,
  value: boolean,
): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("products").update({ is_archived: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateStorefront();
  return { ok: true };
}

// Validate, then upsert the product, replace its variants, and replace its
// add-on overrides. Variants/overrides are replace-all (delete then insert) —
// simplest correct approach for a small menu.
export async function saveProduct(data: ProductFormData): Promise<SaveResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  const name = data.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!data.categoryId) return { ok: false, error: "Pick a category." };

  if (data.pricingMode === "flat") {
    if (data.basePrice == null || !Number.isInteger(data.basePrice) || data.basePrice < 0)
      return { ok: false, error: "Enter a valid price." };
  } else {
    if (data.variants.length === 0)
      return { ok: false, error: "Add at least one size." };
    if (
      data.variants.some(
        (v) => !v.name.trim() || !Number.isInteger(v.price) || v.price < 0,
      )
    ) {
      return { ok: false, error: "Every size needs a name and a valid price." };
    }
  }
  if (data.maxAddons != null && (!Number.isInteger(data.maxAddons) || data.maxAddons < 0))
    return { ok: false, error: "Max add-ons must be a non-negative whole number." };
  // Validate the unified recipe list: grams non-negative ints or null;
  // ingredient/directive entries must carry a cost item id; entries must be
  // well-formed. exclude/override are per-drink directives against the category
  // base (see lib/menu/recipe.ts mergeRecipe).
  for (const entry of data.recipe) {
    if (entry.kind === "ingredient") {
      if (!entry.costItemId)
        return { ok: false, error: "A recipe ingredient is missing its cost item." };
      if (
        entry.grams != null &&
        (!Number.isInteger(entry.grams) || entry.grams < 0)
      )
        return { ok: false, error: "Recipe amounts must be non-negative whole numbers." };
    } else if (entry.kind === "exclude") {
      if (!entry.costItemId)
        return { ok: false, error: "Invalid recipe step." };
    } else if (entry.kind === "override") {
      if (!entry.costItemId || !Number.isInteger(entry.grams) || entry.grams < 0)
        return { ok: false, error: "Recipe amounts must be non-negative whole numbers." };
    } else if (entry.kind === "inherited") {
      // Position marker for a pinned inherited base ingredient; carries an id.
      if (!entry.costItemId)
        return { ok: false, error: "Invalid recipe step." };
    } else if (entry.kind !== "free") {
      return { ok: false, error: "Invalid recipe step." };
    }
  }

  const db = await createClient();
  const slug = data.slug.trim() ? slugify(data.slug) : slugify(name);
  if (!slug)
    return { ok: false, error: "Enter a slug or name with letters or numbers." };

  // Drop blank free steps; keep ingredient + directive steps (ingredients
  // render from a template even with empty text; exclude/override have no text).
  const cleanRecipe = data.recipe.filter((e) =>
    e.kind === "free" ? e.text.trim().length > 0 : true,
  );

  const payload = {
    category_id: data.categoryId,
    slug,
    name,
    description: data.description.trim(),
    image_url: data.imageUrl,
    base_price: data.pricingMode === "flat" ? data.basePrice : null,
    max_addons: data.maxAddons,
    is_best_seller: data.isBestSeller,
    is_new: data.isNew,
    is_featured: data.isFeatured,
    is_available: data.isAvailable,
    recipe: cleanRecipe.length > 0 ? cleanRecipe : null,
  };

  let productId = data.id;
  if (productId) {
    const { error } = await db.from("products").update(payload).eq("id", productId);
    if (error)
      return {
        ok: false,
        error: error.code === "23505" ? "That slug is already used." : error.message,
      };
  } else {
    const { data: row, error } = await db
      .from("products")
      .insert(payload)
      .select("id")
      .single();
    if (error || !row)
      return {
        ok: false,
        error:
          error?.code === "23505"
            ? "That slug is already used."
            : error?.message ?? "Insert failed.",
      };
    productId = row.id;
  }

  // Replace variants. (Not wrapped in a DB transaction — see note above.)
  const variantsDelete = await db
    .from("product_variants")
    .delete()
    .eq("product_id", productId);
  if (variantsDelete.error)
    return { ok: false, error: variantsDelete.error.message };
  if (data.pricingMode === "variants") {
    const rows = data.variants.map((v, i) => ({
      product_id: productId!,
      name: v.name.trim(),
      price: v.price,
      sort_order: i,
    }));
    const { error } = await db.from("product_variants").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  // Replace add-on overrides.
  const addonsDelete = await db
    .from("product_addons")
    .delete()
    .eq("product_id", productId);
  if (addonsDelete.error)
    return { ok: false, error: addonsDelete.error.message };
  if (data.addonOverrides.length > 0) {
    const rows = data.addonOverrides.map((o, i) => ({
      product_id: productId!,
      addon_id: o.addonId,
      mode: o.mode,
      sort_order: i,
    }));
    const { error } = await db.from("product_addons").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  revalidateStorefront();
  return { ok: true, id: productId };
}

// Upload a product image to the public `products` bucket and return its URL.
// Uses the service-role client so the write succeeds regardless of cookie
// propagation; the action is already admin-gated above.
export async function uploadProductImage(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "No file." };
  if (file.size > 5_242_880) return { ok: false, error: "Image must be under 5 MB." };
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type))
    return { ok: false, error: "Only JPEG, PNG, and WebP images are allowed." };

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const db = createAdminClient();
  const { error } = await db.storage
    .from("products")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data } = db.storage.from("products").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
