"use client";

import { createContext, useContext } from "react";

export type OrderMode = "customer" | "store";

// Default "customer" so existing storefront usages need no provider; the store
// layout overrides to "store" for its subtree.
const OrderModeContext = createContext<OrderMode>("customer");

export function OrderModeProvider({
  mode,
  children,
}: {
  mode: OrderMode;
  children: React.ReactNode;
}) {
  return (
    <OrderModeContext.Provider value={mode}>
      {children}
    </OrderModeContext.Provider>
  );
}

export function useOrderMode(): OrderMode {
  return useContext(OrderModeContext);
}

// Navigation targets for the active mode. The kiosk lives under /store with the
// menu at /store and products at /store/<slug>; the storefront uses /menu. Both
// surfaces now use the floating cart sheet (which lives on the menu screen), so
// `cart` and `editReturn` point at the menu — there's no standalone cart page in
// the flow anymore. `editReturn` is where the product page lands after editing a
// cart line; the sheet stays open across the round-trip.
export function useOrderRoutes() {
  const mode = useOrderMode();
  const isStore = mode === "store";
  return {
    mode,
    menu: isStore ? "/store" : "/menu",
    cart: isStore ? "/store" : "/menu",
    editReturn: isStore ? "/store" : "/menu",
    checkout: isStore ? "/store/checkout" : "/checkout",
    product: (slug: string) => (isStore ? `/store/${slug}` : `/menu/${slug}`),
  };
}
