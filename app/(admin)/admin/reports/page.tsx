import { getReportData } from "@/lib/analytics/reports";
import type { ReportRange } from "@/lib/analytics/types";
import { ReportsView } from "@/components/admin/reports-view";
import { isAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Server Action used by the range tabs to re-fetch on the server. Re-checks
// admin since Server Actions are independently callable endpoints.
async function loadReport(range: ReportRange) {
  "use server";
  if (!(await isAdmin())) throw new Error("Not authorized.");
  return getReportData(range);
}

export default async function ReportsPage() {
  const initial = await getReportData("7d");
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Reports</h1>
      <ReportsView initial={initial} load={loadReport} />
    </div>
  );
}
