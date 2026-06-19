import { createClient } from "@/lib/supabase/server";
import type { AdminPromotion } from "@/lib/promotions/types";

// All promotions (incl. inactive), with their target ids. Runs under the caller's
// RLS; the admin SELECT policy returns inactive rows too. Callers gate with
// isAdmin before rendering.
export async function listAdminPromotions(): Promise<AdminPromotion[]> {
  const db = await createClient();
  const [promos, prodLinks, catLinks] = await Promise.all([
    db.from("promotions").select("*").order("sort_order").order("label"),
    db.from("promotion_products").select("*"),
    db.from("promotion_categories").select("*"),
  ]);
  return (promos.data ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    label: p.label,
    percentOff: p.percent_off,
    isActive: p.is_active,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    sortOrder: p.sort_order,
    productIds: (prodLinks.data ?? []).filter((l) => l.promotion_id === p.id).map((l) => l.product_id),
    categoryIds: (catLinks.data ?? []).filter((l) => l.promotion_id === p.id).map((l) => l.category_id),
  }));
}
