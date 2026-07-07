import { listAdminCostItems } from "@/lib/menu/admin";
import { CostManager } from "@/components/admin/cost-manager";

export const dynamic = "force-dynamic";

export default async function AdminCostsPage() {
  const items = await listAdminCostItems();
  return <CostManager initial={items} />;
}
