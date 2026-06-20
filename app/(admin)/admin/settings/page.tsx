import { getStoreSettings } from "@/lib/settings/store";
import { SettingsForm } from "@/components/admin/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getStoreSettings();
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Settings</h1>
      <SettingsForm initial={settings} />
    </div>
  );
}
