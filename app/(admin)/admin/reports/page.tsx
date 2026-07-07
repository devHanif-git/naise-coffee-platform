import { getReportData } from "@/lib/analytics/reports";
import type { AnalyticsRange } from "@/lib/analytics/types";
import { presetToRange, sanitizeRange } from "@/lib/analytics/range";
import { ReportsView } from "@/components/admin/reports-view";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { isAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Server Action used by the range picker to re-fetch on the server. Re-checks
// admin since Server Actions are independently callable endpoints, and sanitizes
// the client-supplied range (clamp future, swap reversed).
async function loadReport(range: AnalyticsRange) {
  "use server";
  if (!(await isAdmin())) throw new Error("Not authorized.");
  return getReportData(sanitizeRange(range));
}

export default async function ReportsPage() {
  const initial = await getReportData(presetToRange("7d"));
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Reports" description="Sales and revenue trends." />
      <ReportsView initial={initial} load={loadReport} />
    </div>
  );
}
