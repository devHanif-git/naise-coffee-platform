import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/checkout-screen";
import { getStoreSettings } from "@/lib/settings/store";

export const metadata: Metadata = {
  title: "Checkout",
};

export default async function CheckoutPage() {
  const settings = await getStoreSettings();
  return (
    <CheckoutScreen
      closedMessage={settings.isOpen ? null : settings.closedMessage}
    />
  );
}
