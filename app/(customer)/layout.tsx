import { redirect } from "next/navigation";
import { TabBar } from "@/components/tab-bar";
import { CartFab } from "@/components/cart-fab";
import { AuthProvider } from "@/store/auth";
import { CartProvider } from "@/store/cart";
import { BeansProvider } from "@/store/beans";
import { ProfileProvider } from "@/store/profile";
import { WelcomeModal } from "@/components/welcome-modal";
import { RouteTracker } from "@/components/route-tracker";
import { getLoyaltySettings } from "@/lib/rewards/config-store";
import { getStoreSettings } from "@/lib/settings/store";
import { inStoreMode } from "@/lib/auth/store-mode";
import { StoreEnter } from "@/components/store/store-enter";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // While the device is in store mode, lock the customer storefront to the
  // kiosk so a customer can't wander off the /store flow. /manage and other
  // (admin) routes are a different group and are unaffected, so staff can still
  // jump to the order board without exiting store mode.
  if (await inStoreMode()) redirect("/store");
  const { beansPerRinggit } = await getLoyaltySettings();
  const { rewardsEnabled } = await getStoreSettings();
  return (
    <AuthProvider>
      <ProfileProvider>
        <BeansProvider earnRate={beansPerRinggit}>
          <CartProvider>
            <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
              <RouteTracker menuBase="/menu" />
              {children}
              <StoreEnter />
              <CartFab />
              <TabBar showRewards={rewardsEnabled} />
            </div>
            <WelcomeModal />
          </CartProvider>
        </BeansProvider>
      </ProfileProvider>
    </AuthProvider>
  );
}
