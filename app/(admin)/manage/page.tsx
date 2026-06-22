import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canManageOrders } from "@/lib/auth/session";
import { countOrdersByGroup, listOrdersPage } from "@/lib/orders/store";
import { ManageOrdersLive } from "@/components/manage-orders-live";

export const metadata: Metadata = {
  title: "Manage Orders",
  robots: { index: false, follow: false },
};

// The board opens on the Pending tab across all dates, so staff see every
// outstanding order until they switch tabs or narrow the date range.
const DEFAULT_FILTER = "pending" as const;
const DEFAULT_RANGE = "all" as const;

export default async function ManageOrdersPage(props: PageProps<"/manage">) {
  if (!(await canManageOrders())) redirect("/");

  // Back link follows where the staffer came from: the customer profile passes
  // ?from=profile; everything else (dashboard button, admin sidebar) returns to
  // the dashboard, which is also the sensible default.
  const { from } = await props.searchParams;
  const fromProfile = from === "profile";
  const backHref = fromProfile ? "/profile" : "/admin";
  const backLabel = fromProfile ? "Profile" : "Dashboard";

  const [{ orders, hasMore }, counts] = await Promise.all([
    listOrdersPage({ filter: DEFAULT_FILTER, range: DEFAULT_RANGE, offset: 0 }),
    countOrdersByGroup(DEFAULT_RANGE),
  ]);

  return (
    <ManageOrdersLive
      initialOrders={orders}
      initialHasMore={hasMore}
      initialCounts={counts}
      initialFilter={DEFAULT_FILTER}
      initialRange={DEFAULT_RANGE}
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}
