"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Records whether the user is currently on a product page, so the menu can
// restore its browse position only when the user comes *back* from a product —
// not when landing fresh from another tab (e.g. tapping Menu after signing in),
// which should show the top of the list.
//
// The flag is set while the user is on the product page (a fully-committed
// navigation) and deliberately left untouched when they land on the menu list
// itself. That avoids a read/write race: the menu page is an async server
// component, so this tracker (in the layout) commits and runs its effect before
// the slower menu page renders and reads the flag. By no-op-ing on the list path
// we guarantee the menu reads the value set back on the product page, regardless
// of render order. The menu consumes (clears) the flag once it restores.
//
// `menuBase` is the list path for the active surface ("/menu" storefront,
// "/store" kiosk); product paths are nested under it (e.g. /menu/<slug>).
const FROM_PRODUCT_KEY = "menu:from-product";

export function RouteTracker({ menuBase }: { menuBase: string }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.startsWith(`${menuBase}/`)) {
      sessionStorage.setItem(FROM_PRODUCT_KEY, "1");
    } else if (pathname !== menuBase) {
      // Left to some other screen (cart, profile, …) — the next menu visit is
      // not a product round-trip, so drop the flag.
      sessionStorage.removeItem(FROM_PRODUCT_KEY);
    }
    // pathname === menuBase: leave the flag as-is for the menu to read & clear.
  }, [pathname, menuBase]);
  return null;
}
