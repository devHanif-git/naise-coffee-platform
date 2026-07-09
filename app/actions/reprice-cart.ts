"use server";

import { listProductsFresh } from "@/lib/menu/store";
import { repriceLine } from "@/lib/promotions/reprice";

// A cart line reduced to what re-pricing needs: its stable cart `key` (so the
// client can map the result back) plus the identifying product/size/add-ons.
export type RepriceCartLine = {
  key: string;
  productId?: string;
  sizeId?: string;
  addonIds: string[];
  isReward?: boolean;
};

export type RepriceCartPatch = {
  unitPrice: number;
  unitOriginalPrice: number;
  discountLabel?: string;
  discountPercentOff?: number;
};

// Re-prices the given cart lines against the live catalogue and returns a patch
// per line whose price fields changed, keyed by cart `key`. Lines that can't be
// re-priced (custom/off-menu, or an id that no longer exists) are omitted, so
// the client keeps their existing snapshot. Read-only: this never mutates the
// cart — the client applies the patches to its localStorage-backed store.
export async function repriceCart(
  lines: RepriceCartLine[],
): Promise<Record<string, RepriceCartPatch>> {
  if (lines.length === 0) return {};
  const catalog = await listProductsFresh();
  const patches: Record<string, RepriceCartPatch> = {};
  for (const line of lines) {
    const repriced = repriceLine(
      {
        productId: line.productId,
        sizeId: line.sizeId,
        addonIds: line.addonIds,
        isReward: line.isReward,
      },
      catalog,
    );
    if (!repriced) continue;
    patches[line.key] = {
      unitPrice: repriced.unitPrice,
      unitOriginalPrice: repriced.unitOriginalPrice,
      discountLabel: repriced.discountLabel,
      discountPercentOff: repriced.discountPercentOff,
    };
  }
  return patches;
}
