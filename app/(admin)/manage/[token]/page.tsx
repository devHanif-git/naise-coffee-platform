import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PackageX } from "lucide-react";
import { OrderDetail } from "@/components/order-detail";
import { canManageOrders } from "@/lib/auth/session";
import { getOrderByToken } from "@/lib/orders/store";

export const runtime = 'edge';

// Management view is internal — keep it out of search results.
export const metadata: Metadata = {
  title: "Manage Order",
  robots: { index: false, follow: false },
};

export default async function ManageOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Gate first: only staff roles may open an order link. Anyone else (including
  // signed-out visitors who guess/share the link) is sent back to the store.
  if (!(await canManageOrders())) redirect("/");

  const { token } = await params;
  const order = getOrderByToken(token);

  if (!order) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100 text-muted-foreground">
          <PackageX className="size-8" strokeWidth={2} aria-hidden />
        </div>
        <h1 className="font-heading text-xl font-bold tracking-tight">
          Order not found
        </h1>
        <p className="max-w-[18rem] text-sm leading-relaxed text-muted-foreground">
          This link is invalid or the order is no longer available.
        </p>
      </main>
    );
  }

  return <OrderDetail order={order} />;
}
