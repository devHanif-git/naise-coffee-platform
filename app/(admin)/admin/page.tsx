import Link from "next/link";
import { Plus, ClipboardList } from "lucide-react";
import { getDashboardMetrics } from "@/lib/analytics/dashboard";
import type { AnalyticsRange } from "@/lib/analytics/types";
import { presetToRange, sanitizeRange } from "@/lib/analytics/range";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { DashboardView } from "@/components/admin/dashboard-view";
import { Button } from "@/components/ui/button";
import { isAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Re-fetch on the server when the range changes. Re-checks admin (Server Actions
// are independently callable) and sanitizes the client-supplied range.
async function loadDashboard(range: AnalyticsRange) {
  "use server";
  if (!(await isAdmin())) throw new Error("Not authorized.");
  return getDashboardMetrics(sanitizeRange(range));
}

export default async function AdminDashboardPage() {
  const initialRange = presetToRange("today");
  const initial = await getDashboardMetrics(initialRange);

  return (
    <div className="flex flex-col gap-7">
      <AdminPageHeader title="Dashboard" description="Store performance at a glance.">
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <Link href="/manage">
            <ClipboardList className="size-4" aria-hidden />
            Orders
          </Link>
        </Button>
        <Button asChild size="sm" className="rounded-full">
          <Link href="/admin/menu/new">
            <Plus className="size-4" aria-hidden />
            New item
          </Link>
        </Button>
      </AdminPageHeader>

      <DashboardView initial={initial} initialRange={initialRange} load={loadDashboard} />
    </div>
  );
}
