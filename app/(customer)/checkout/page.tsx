import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/checkout-screen";
import { getStoreSettings } from "@/lib/settings/store";
import { getPaymentSettings, getEnabledPaymentMethods } from "@/lib/settings/payments";

export const metadata: Metadata = {
  title: "Checkout",
};

export default async function CheckoutPage() {
  const [settings, payments] = await Promise.all([getStoreSettings(), getPaymentSettings()]);
  const methods = getEnabledPaymentMethods(payments);
  return (
    <CheckoutScreen
      closedMessage={settings.isOpen ? null : settings.closedMessage}
      methods={methods}
      bank={payments.bank}
      duitnowQrUrl={payments.duitnowQrUrl}
    />
  );
}
