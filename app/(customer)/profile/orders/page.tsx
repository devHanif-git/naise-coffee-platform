import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listOrdersFor } from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";
import { CustomerOrderCard } from "@/components/customer-order-card";

export const metadata: Metadata = {
  title: "Your Orders",
  description: "Your full order history at Naise Coffee.",
};

export default async function ProfileOrdersPage() {
  const ownerId = await getOwnerIdFromCookie();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orders = await listOrdersFor(ownerId, user?.id ?? null);

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href="/profile"
          aria-label="Back to profile"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Orders
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="px-5 pb-8 pt-2">
        {orders.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No orders yet.</p>
            <Link
              href="/menu"
              className="text-xs font-semibold text-foreground underline-offset-2 hover:underline"
            >
              Browse the menu
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {orders.map((order, i) => (
              <CustomerOrderCard key={order.token} order={order} delay={i * 60} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
