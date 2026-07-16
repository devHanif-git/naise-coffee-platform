import { redirect } from "next/navigation";
import { canManageOrders } from "@/lib/auth/session";
import { getShiftSummary, listShiftHistory } from "@/lib/shifts/store";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ShiftView } from "@/components/admin/shift-view";

export const dynamic = "force-dynamic";

export default async function ShiftPage() {
  if (!(await canManageOrders())) redirect("/");
  const [summary, history] = await Promise.all([
    getShiftSummary(),
    listShiftHistory(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Shift" description="Open, close & count the drawer." />
      <ShiftView summary={summary} history={history} />
    </div>
  );
}
