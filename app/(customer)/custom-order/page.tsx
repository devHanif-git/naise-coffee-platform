import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth/session";
import { getPaymentSettings } from "@/lib/settings/payments";
import { getCustomDrinkPresets } from "@/lib/custom-order/presets";
import { CustomOrderScreen } from "@/components/custom-order/custom-order-screen";

export const dynamic = "force-dynamic";

export default async function CustomOrderPage() {
  if (!(await isAdmin())) redirect("/profile");

  const [presets, payments] = await Promise.all([
    getCustomDrinkPresets(),
    getPaymentSettings(),
  ]);
  const cashOk = payments.categories.cash && payments.methods.cash;
  const qrOk = payments.categories.qr && payments.methods["duitnow-qr"];

  return (
    <CustomOrderScreen
      presets={presets}
      cashOk={cashOk}
      qrOk={qrOk}
      qrUrl={payments.duitnowQrUrl}
    />
  );
}
