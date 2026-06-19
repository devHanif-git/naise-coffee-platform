import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/checkout-screen";
import { getStoreSettings } from "@/lib/settings/store";
import { StoreClosedBanner } from "@/components/store-closed-banner";

export const metadata: Metadata = {
  title: "Checkout",
};

export default async function CheckoutPage() {
  const settings = await getStoreSettings();
  return (
    <>
      {!settings.isOpen && <StoreClosedBanner message={settings.closedMessage} />}
      <CheckoutScreen />
    </>
  );
}
