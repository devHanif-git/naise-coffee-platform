import { listAdminAddons } from "@/lib/menu/admin";
import { AddonManager } from "@/components/admin/addon-manager";

export const dynamic = "force-dynamic";

export default async function AddonsPage() {
  const addons = await listAdminAddons();
  return <AddonManager initial={addons} />;
}
