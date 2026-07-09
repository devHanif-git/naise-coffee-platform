import { AuthProvider } from "@/store/auth";
import { BeansProvider } from "@/store/beans";
import { CartProvider } from "@/store/cart";
import { OrderModeProvider } from "@/store/order-mode";
import { StoreShell } from "@/components/store/store-shell";
import { CartRepricer } from "@/components/cart-repricer";
import { RouteTracker } from "@/components/route-tracker";
import { getLoyaltySettings } from "@/lib/rewards/config-store";
import { STORE_CART_KEY, STORE_CART_NOTES_KEY } from "@/constants/store";

export const dynamic = "force-dynamic";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  // BeansProvider is required by ProductCustomizer's useBeans(); the kiosk never
  // shows beans, and the empty reward catalog keeps reward mode permanently off.
  const { beansPerRinggit } = await getLoyaltySettings();
  return (
    <AuthProvider>
      <BeansProvider earnRate={beansPerRinggit}>
        <OrderModeProvider mode="store">
          <CartProvider storageKey={STORE_CART_KEY} notesStorageKey={STORE_CART_NOTES_KEY}>
            <CartRepricer />
            <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col bg-background">
              <RouteTracker menuBase="/store" />
              <StoreShell>{children}</StoreShell>
            </div>
          </CartProvider>
        </OrderModeProvider>
      </BeansProvider>
    </AuthProvider>
  );
}
