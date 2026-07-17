import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { canManageOrders } from "@/lib/auth/session";
import { getShiftSummary, listShiftHistory } from "@/lib/shifts/store";
import { ShiftView } from "@/components/admin/shift-view";

export const dynamic = "force-dynamic";

export default async function ShiftPage(props: PageProps<"/shift">) {
  if (!(await canManageOrders())) redirect("/");

  // Back link follows where the staffer came from: the customer profile passes
  // ?from=profile, the orders board passes ?from=manage; everything else (admin
  // sidebar) returns to the dashboard.
  const { from } = await props.searchParams;
  const backHref =
    from === "profile" ? "/profile" : from === "manage" ? "/manage" : "/admin";
  const backLabel =
    from === "profile"
      ? "Profile"
      : from === "manage"
        ? "Manage Orders"
        : "Dashboard";

  const [summary, history] = await Promise.all([
    getShiftSummary(),
    listShiftHistory(),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
      <header className="flex flex-col gap-1">
        <Link
          href={backHref}
          className="mb-2 flex w-fit items-center gap-1 rounded-sm text-sm font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-4" aria-hidden /> {backLabel}
        </Link>
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          NAISE Coffee
        </span>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Shift</h1>
        <p className="text-sm text-muted-foreground">
          Open, close &amp; count the drawer.
        </p>
      </header>

      <div className="mt-6">
        <ShiftView summary={summary} history={history} />
      </div>
    </main>
  );
}
