import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/checkout-screen";
import { getStoreSettings } from "@/lib/settings/store";
import { getPaymentSettings, getEnabledPaymentMethods } from "@/lib/settings/payments";
import { getStampSettings } from "@/lib/stamps/config-store";
import { listMyVouchers } from "@/lib/stamps/voucher-store";

export const metadata: Metadata = {
  title: "Checkout",
};

export default async function CheckoutPage() {
  const [settings, payments, stampSettings] = await Promise.all([
    getStoreSettings(),
    getPaymentSettings(),
    getStampSettings(),
  ]);
  const methods = getEnabledPaymentMethods(payments);
  // Only offer vouchers when the program is on. listMyVouchers is RLS-scoped to
  // the signed-in member (the checkout route is gated).
  const vouchers = stampSettings.isEnabled ? await listMyVouchers() : [];
  return (
    <CheckoutScreen
      closedMessage={settings.isOpen ? null : settings.closedMessage}
      methods={methods}
      bank={payments.bank}
      duitnowQrUrl={payments.duitnowQrUrl}
      vouchers={vouchers.filter((v) => v.status === "active")}
      chipEnabled={payments.chip.enabled}
    />
  );
}
