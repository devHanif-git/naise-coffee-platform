import { Ticket, Coffee } from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { Voucher } from "@/types/reward";
import { cn } from "@/lib/utils";

// A member's vouchers, rendered as tickets. Active ones are solid black with a
// notched edge; redeemed/expired are dimmed and lined-through. Server component.
export function VoucherList({ vouchers }: { vouchers: Voucher[] }) {
  if (vouchers.length === 0) return null;

  const fmtExpiry = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric",
      month: "short",
    }).format(new Date(iso));

  return (
    <section aria-labelledby="my-vouchers-heading" className="naise-rise [animation-delay:80ms]">
      <h2
        id="my-vouchers-heading"
        className="text-xs font-bold uppercase tracking-wide"
      >
        My Vouchers
      </h2>

      <ul className="mt-3 flex flex-col gap-2.5">
        {vouchers.map((v) => {
          const active = v.status === "active";
          const isFree = v.type === "free_drink";
          const headline = isFree ? "Free Drink" : `${formatPrice(v.discountAmount)} Off`;
          const sub = isFree
            ? `Up to ${formatPrice(v.freeDrinkMaxValue)}`
            : `Min spend ${formatPrice(v.minSpend)}`;
          return (
            <li
              key={v.id}
              className={cn(
                // Ticket: two panels split by a dashed divider + notches.
                "relative flex items-stretch overflow-hidden rounded-2xl",
                active ? "bg-black text-white" : "border border-border bg-white text-foreground opacity-60",
              )}
            >
              {/* Icon stub */}
              <div
                className={cn(
                  "flex w-14 shrink-0 items-center justify-center",
                  active ? "bg-white/10" : "bg-neutral-100",
                )}
              >
                {isFree ? (
                  <Coffee className="size-5" strokeWidth={2} aria-hidden />
                ) : (
                  <Ticket className="size-5" strokeWidth={2} aria-hidden />
                )}
              </div>

              {/* Notches on the divider seam */}
              <span
                aria-hidden
                className="absolute left-[3.25rem] top-0 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background"
              />
              <span
                aria-hidden
                className="absolute bottom-0 left-[3.25rem] size-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-background"
              />

              <div className="flex flex-1 items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p
                    className={cn(
                      "font-heading text-base font-bold uppercase tracking-wide",
                      !active && "line-through",
                    )}
                  >
                    {headline}
                  </p>
                  <p className={cn("text-[0.6875rem]", active ? "text-white/60" : "text-muted-foreground")}>
                    {sub}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-[0.625rem] font-semibold uppercase tracking-wide",
                    active ? "text-white/70" : "text-muted-foreground",
                  )}
                >
                  {active ? `Exp ${fmtExpiry(v.expiresAt)}` : v.status}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
