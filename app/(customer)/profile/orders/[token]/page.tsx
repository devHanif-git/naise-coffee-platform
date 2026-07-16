import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, PackageX, Clock } from "lucide-react";
import {
  getOrderByToken,
  getChipPurchaseByToken,
  markOrderPaid,
} from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";
import { retrievePurchase } from "@/lib/payments/chip/client";
import { settlePaidOrder } from "@/app/(customer)/checkout/actions";
import { CustomerOrderLive } from "@/components/customer-order-live";

export const metadata: Metadata = {
  title: "Order Detail",
};

export default async function ProfileOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { token } = await params;
  const { from } = await searchParams;
  let order = await getOrderByToken(token);

  // Opened from the profile's recent-orders preview → back to that section;
  // otherwise back to the full orders list.
  const backHref = from === "profile" ? "/profile#recent-orders" : "/profile/orders";

  // Ownership gate (defense-in-depth on top of the unguessable token): only the
  // member who placed it (user_id) or the browser that owns it (owner_id cookie)
  // may view a customer order. getOrderByToken reads via the service role, so
  // this is the only ownership check on this page. A mismatch renders the same
  // not-found state rather than leaking another customer's order details.
  let owned = false;
  if (order) {
    const ownerId = await getOwnerIdFromCookie();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    owned =
      (user?.id != null && order.userId === user.id) ||
      (ownerId != null && order.ownerId === ownerId);
  }

  // Belt-and-braces reconciliation: the webhook is the source of truth but can
  // lag. If this is an owned awaiting_payment order and CHIP already reports it
  // paid, flip + settle here so the customer sees confirmation without waiting on
  // the webhook. markOrderPaid's awaiting_payment guard makes this safe against a
  // concurrent webhook — whichever runs first flips it, the other no-ops.
  if (order && owned && order.status === "awaiting_payment") {
    const purchase = await getChipPurchaseByToken(token);
    if (purchase) {
      try {
        const remote = await retrievePurchase(purchase.chipPurchaseId);
        if (remote.status === "paid") {
          const paid = await markOrderPaid(purchase.chipPurchaseId);
          if (paid) {
            await settlePaidOrder(paid.token);
            order = paid;
          }
        }
      } catch {
        // Ignore — fall through to the awaiting-payment UI; the webhook settles.
      }
    }
  }

  if (!order || !owned) {
    return (
      <div className="flex flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
          <Link
            href={backHref}
            aria-label="Back"
            className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-6" aria-hidden />
          </Link>
          <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
            Order
          </h1>
          <div className="size-9" aria-hidden />
        </header>
        <main className="flex flex-col items-center justify-center gap-4 px-5 py-16 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100 text-muted-foreground">
            <PackageX className="size-8" strokeWidth={2} aria-hidden />
          </div>
          <h2 className="font-heading text-xl font-bold tracking-tight">
            Order not found
          </h2>
          <p className="max-w-[18rem] text-sm leading-relaxed text-muted-foreground">
            This order is no longer available.
          </p>
        </main>
      </div>
    );
  }

  // Still awaiting payment after reconciliation → show a "confirming payment"
  // state with a link back to the review screen to resume/complete paying,
  // rather than the fulfilment tracker (the order isn't paid yet).
  if (order.status === "awaiting_payment") {
    return (
      <div className="flex flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
          <Link
            href={backHref}
            aria-label="Back"
            className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-6" aria-hidden />
          </Link>
          <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
            Order
          </h1>
          <div className="size-9" aria-hidden />
        </header>
        <main className="flex flex-col items-center justify-center gap-4 px-5 py-16 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-yellow-50 text-yellow-700">
            <Clock className="size-8" strokeWidth={2} aria-hidden />
          </div>
          <h2 className="font-heading text-xl font-bold tracking-tight">
            Waiting for payment
          </h2>
          <p className="max-w-[18rem] text-sm leading-relaxed text-muted-foreground">
            We haven&rsquo;t received confirmation for order {order.orderNumber} yet.
            If you haven&rsquo;t paid, you can complete it now.
          </p>
          <Link
            href={`/checkout/pay/${order.token}`}
            className="mt-2 rounded-2xl bg-amber-500 px-6 py-3 font-semibold text-black transition-colors hover:bg-amber-400"
          >
            Complete payment
          </Link>
        </main>
      </div>
    );
  }

  return <CustomerOrderLive order={order} backHref={backHref} />;
}
