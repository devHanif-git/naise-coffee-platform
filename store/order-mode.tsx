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
// menu at /store and products at /store/<slug>; the storefront uses /menu.
export function useOrderRoutes() {
  const mode = useOrderMode();
  const isStore = mode === "store";
  return {
    mode,
    menu: isStore ? "/store" : "/menu",
    cart: isStore ? "/store/cart" : "/cart",
    product: (slug: string) => (isStore ? `/store/${slug}` : `/menu/${slug}`),
  };
}
