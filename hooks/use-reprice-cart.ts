"use client";

import { useCallback, useEffect, useRef } from "react";
import { useCart } from "@/store/cart";
import { repriceCart, type RepriceCartLine } from "@/app/actions/reprice-cart";

// Returns a STABLE `reprice()` that re-prices the current cart against the live
// catalogue and silently applies any corrections. Call it whenever prices are
// about to be shown (cart sheet opens, checkout mounts) — not just when cart
// contents change — so a promotion started or ended in the CMS is reflected
// without a full page refresh.
//
// The callback reads the latest cart state through refs, so its identity never
// changes and it can't close over a stale/empty `items` snapshot. That matters
// for mount-only effects: a plain useCallback bound to `items` can be captured
// on the pre-hydration render (empty cart) and then hit the empty-cart
// early-return forever. Reading from a ref removes that timing trap.
//
// Safe to call repeatedly: an in-flight run is de-duped, and applying patches is
// a no-op when nothing changed (repriceItems returns the same array), so it
// never loops or triggers a needless re-render. Failures are swallowed — the
// server re-prices authoritatively at checkout regardless.
export function useRepriceCart(): () => Promise<void> {
  const { items, hydrated, repriceItems } = useCart();

  // Mirror the live cart into refs so the stable callback below always sees the
  // current values rather than the render it was created on.
  const stateRef = useRef({ items, hydrated, repriceItems });
  useEffect(() => {
    stateRef.current = { items, hydrated, repriceItems };
  });

  const running = useRef(false);

  return useCallback(async () => {
    const { items, hydrated, repriceItems } = stateRef.current;
    if (!hydrated || items.length === 0 || running.current) return;
    running.current = true;
    try {
      const lines: RepriceCartLine[] = items.map((i) => ({
        key: i.key,
        productId: i.productId,
        sizeId: i.sizeId,
        addonIds: i.addonIds,
        isReward: i.isReward,
      }));
      const patches = await repriceCart(lines);
      if (Object.keys(patches).length > 0) repriceItems(patches);
    } catch {
      // Non-fatal: keep the current snapshot; checkout re-prices server-side.
    } finally {
      running.current = false;
    }
  }, []);
}
