import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrderByToken, getChipPurchaseByToken } from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";
import { duitnowQrCheckoutUrl } from "@/lib/payments/chip/client";
import { PaymentReview } from "@/components/payment-review";

export const metadata: Metadata = { title: "Confirm Payment" };

export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await getOrderByToken(token);

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

  // Not found / not owned → back to checkout.
  if (!order || !owned) redirect("/checkout");
  // Already resolved → send to the order status page (paid) or checkout.
  if (order.status !== "awaiting_payment") {
    redirect(`/profile/orders/${order.token}`);
  }

  // The CHIP checkout link was stored when the purchase was created. Append the
  // DuitNow-QR direct-post param so "Pay now" lands straight on the QR screen.
  const purchase = await getChipPurchaseByToken(token);
  const payUrl = purchase ? duitnowQrCheckoutUrl(purchase.checkoutUrl) : "";

  const fee = order.gatewayFee ?? 0;
  return (
    <PaymentReview
      token={order.token}
      transactionNo={purchase?.chipPurchaseId ?? ""}
      orderNumber={order.orderNumber}
      createdAt={order.createdAt}
      amount={order.total}
      fee={fee}
      total={order.total + fee}
      payUrl={payUrl}
    />
  );
}
