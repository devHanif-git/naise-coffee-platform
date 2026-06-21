import { getStoreSettings } from "@/lib/settings/store";
import { getPaymentSettings } from "@/lib/settings/payments";
import { SettingsForm } from "@/components/admin/settings-form";
import { PaymentSettingsForm } from "@/components/admin/payment-settings-form";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, payments] = await Promise.all([getStoreSettings(), getPaymentSettings()]);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <AdminPageHeader title="Settings" description="Store and payment configuration." />
      <SettingsForm initial={settings} />
      <PaymentSettingsForm initial={payments} />
    </div>
  );
}
