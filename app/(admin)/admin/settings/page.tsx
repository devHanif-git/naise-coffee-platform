import { getStoreSettings } from "@/lib/settings/store";
import { getPaymentSettings } from "@/lib/settings/payments";
import { getStoreAccountStatus } from "@/lib/settings/store-account";
import { SettingsForm } from "@/components/admin/settings-form";
import { PaymentSettingsForm } from "@/components/admin/payment-settings-form";
import { StoreAccountForm } from "@/components/admin/store-account-form";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, payments, storeAccount] = await Promise.all([
    getStoreSettings(),
    getPaymentSettings(),
    getStoreAccountStatus(),
  ]);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <AdminPageHeader title="Settings" description="Store and payment configuration." />
      <SettingsForm initial={settings} />
      <PaymentSettingsForm initial={payments} />
      <StoreAccountForm initial={storeAccount} />
    </div>
  );
}
