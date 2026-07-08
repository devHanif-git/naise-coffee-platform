import { formatPrice } from "@/lib/format";
import type { Voucher } from "@/types/reward";

// A member's vouchers. Active ones show value + expiry; redeemed/expired are
// dimmed. Server component — no interactivity.
export function VoucherList({ vouchers }: { vouchers: Voucher[] }) {
  if (vouchers.length === 0) return null;

  const fmtExpiry = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric",
      month: "short",
    }).format(new Date(iso));

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider">My Vouchers</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {vouchers.map((v) => {
          const active = v.status === "active";
          const title =
            v.type === "rm_off"
              ? `${formatPrice(v.discountAmount)} off (min ${formatPrice(v.minSpend)})`
              : `Free drink (up to ${formatPrice(v.freeDrinkMaxValue)})`;
          return (
            <li
              key={v.id}
              className={`flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm ${active ? "" : "opacity-50"}`}
            >
              <span>{title}</span>
              <span className="text-xs text-muted-foreground">
                {active ? `Expires ${fmtExpiry(v.expiresAt)}` : v.status}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
