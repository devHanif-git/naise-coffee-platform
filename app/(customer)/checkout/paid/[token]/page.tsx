import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getOrderByToken,
  getChipPurchaseByToken,
  markOrderPaid,
} from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";
import { retrievePurchase } from "@/lib/payments/chip/client";
import { settlePaidOrder } from "@/app/(customer)/checkout/actions";
import { OrderConfirmed } from "@/components/order-confirmed";
import { PaymentWaitingPoller } from "@/components/payment-waiting-poller";

export const metadata: Metadata = { title: "Order Confirmed" };

// Where CHIP redirects the browser after a DuitNow QR payment. Reconciles the
// order against CHIP on landing (the webhook is the source of truth but can lag,
// and can't reach localhost at all), then shows the "You're all set" screen with
// a Back to menu CTA — instead of dropping the customer deep in the profile
// order-tracker stack.
export default async function PaidPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let order = await getOrderByToken(token);

  // Ownership gate (defense-in-depth on top of the unguessable token).
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

  if (!order || !owned) redirect("/menu");

  // Reconcile: if CHIP reports paid, flip + settle now so this render shows the
  // confirmation. Safe against a concurrent webhook via markOrderPaid's guard.
  if (order.status === "awaiting_payment") {
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
        // Ignore — fall through; the poller re-runs this render until paid.
      }
    }
  }

  // Paid → celebration. Still awaiting → keep polling this route; the payment
  // just hasn't confirmed yet (webhook lag), and each refresh re-reconciles.
  if (order.status === "awaiting_payment") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-5 py-16 text-center">
        <PaymentWaitingPoller />
        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
          Confirming Payment
        </p>
        <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight">
          Just a moment…
        </h1>
        <p className="mt-2 max-w-[17rem] text-xs leading-relaxed text-muted-foreground">
          We&rsquo;re confirming your payment. This page updates automatically.
        </p>
      </main>
    );
  }

  return <OrderConfirmed orderNumber={order.orderNumber} />;
}
