import { redirect } from "next/navigation";
import { TabBar } from "@/components/tab-bar";
import { CartFab } from "@/components/cart-fab";
import { AuthProvider } from "@/store/auth";
import { CartProvider } from "@/store/cart";
import { BeansProvider } from "@/store/beans";
import { ProfileProvider } from "@/store/profile";
import { WelcomeModal } from "@/components/welcome-modal";
import { getLoyaltySettings } from "@/lib/rewards/config-store";
import { getStoreSettings } from "@/lib/settings/store";
import { getSessionRole } from "@/lib/auth/session";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The in-store kiosk account must never see the customer storefront — lock it
  // into the /store flow.
  if ((await getSessionRole()) === "store") redirect("/store");
  const { beansPerRinggit } = await getLoyaltySettings();
  const { rewardsEnabled } = await getStoreSettings();
  return (
    <AuthProvider>
      <ProfileProvider>
        <BeansProvider earnRate={beansPerRinggit}>
          <CartProvider>
            <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
              {children}
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
