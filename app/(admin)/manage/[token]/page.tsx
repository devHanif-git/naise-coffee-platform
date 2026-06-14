import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PackageX } from "lucide-react";
import { formatPrice } from "@/lib/format";
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Manage Order
        </span>
        <h1 className="font-heading text-2xl font-bold tracking-tight tabular-nums">
          {order.orderNumber}
        </h1>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-neutral-100 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Status</dt>
          <dd className="mt-0.5 text-sm font-bold capitalize">
            {order.status}
          </dd>
        </div>
        <div className="rounded-2xl bg-neutral-100 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Payment</dt>
          <dd className="mt-0.5 text-sm font-bold">{order.paymentMethod}</dd>
        </div>
      </dl>

      <section className="mt-7 flex flex-col gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wider">Items</h2>
        <ul className="flex flex-col divide-y divide-border rounded-2xl bg-neutral-50 px-4">
          {order.items.map((item, i) => {
            const subtitle = [item.sizeName, ...item.addonNames]
              .filter(Boolean)
              .join(", ");
            return (
              <li
                key={`${item.name}-${i}`}
                className="flex items-center gap-3 py-3.5 text-sm"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-black text-xs font-bold tabular-nums text-white">
                  {item.quantity}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{item.name}</span>
                  {subtitle && (
                    <span className="truncate text-xs text-muted-foreground">
                      {subtitle}
                    </span>
                  )}
                </div>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatPrice(item.lineTotal)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {order.notes && (
        <section className="mt-5 rounded-2xl bg-neutral-50 px-4 py-3 text-sm">
          <span className="font-semibold">Note: </span>
          <span className="whitespace-pre-line break-words">{order.notes}</span>
        </section>
      )}

      <section className="mt-7 flex flex-col gap-2 border-t border-border pt-5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatPrice(order.subtotal)}</span>
        </div>
        <div className="flex items-baseline justify-between text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(order.total)}</span>
        </div>
      </section>
    </main>
  );
}
