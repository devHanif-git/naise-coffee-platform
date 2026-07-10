import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canManageOrders } from "@/lib/auth/session";
import { countOrdersByGroup, listOrdersPage } from "@/lib/orders/store";
import { getPaymentSettings, getEnabledPaymentMethods } from "@/lib/settings/payments";
import { UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
import type { PaymentFilterOption } from "@/lib/orders/status";
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

  const [{ orders, hasMore }, counts, paymentSettings] = await Promise.all([
    listOrdersPage({ filter: DEFAULT_FILTER, range: DEFAULT_RANGE, offset: 0 }),
    countOrdersByGroup(DEFAULT_RANGE),
    getPaymentSettings(),
  ]);

  // Payment quick-filter chips: "All payments" plus one chip per CMS-enabled
  // method, in catalog order. A method the store has disabled (e.g. bank
  // transfer switched off) simply never appears. The "Unpaid" chip is added when
  // pay-later is enabled, so staff can find store orders awaiting payment.
  const paymentOptions: PaymentFilterOption[] = [
    { value: "all", label: "All payments" },
    ...getEnabledPaymentMethods(paymentSettings).map((m) => ({
      value: m.id,
      label: m.name,
    })),
    ...(paymentSettings.payLaterEnabled
      ? [{ value: UNPAID_PAYMENT_METHOD, label: "Unpaid" }]
      : []),
  ];

  return (
    <ManageOrdersLive
      initialOrders={orders}
      initialHasMore={hasMore}
      initialCounts={counts}
      initialFilter={DEFAULT_FILTER}
      initialRange={DEFAULT_RANGE}
      paymentOptions={paymentOptions}
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}
