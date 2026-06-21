import { getPaymentSettings } from "@/lib/settings/payments";
import { getStoreSettingsForCheckout } from "@/lib/settings/store";
import { StoreCheckout } from "@/components/store/store-checkout";

export const dynamic = "force-dynamic";

export default async function StoreCheckoutPage() {
  const [payments, settings] = await Promise.all([
    getPaymentSettings(),
    getStoreSettingsForCheckout(),
  ]);
  const cashOk = payments.categories.cash && payments.methods.cash;
  const qrOk = payments.categories.qr && payments.methods["duitnow-qr"];
  return (
    <StoreCheckout
      cashOk={cashOk}
      qrOk={qrOk}
      qrUrl={payments.duitnowQrUrl}
      closedMessage={settings.isOpen ? null : settings.closedMessage}
    />
  );
}
