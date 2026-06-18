import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, PackageX } from "lucide-react";
import { getOrderByToken } from "@/lib/orders/store";
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
  const order = await getOrderByToken(token);

  // Opened from the profile's recent-orders preview → back to that section;
  // otherwise back to the full orders list.
  const backHref = from === "profile" ? "/profile#recent-orders" : "/profile/orders";

  if (!order) {
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

  return <CustomerOrderLive order={order} backHref={backHref} />;
}
