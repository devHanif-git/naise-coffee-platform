"use client";

import { useState } from "react";
import { Check, Coffee, Ticket, TriangleAlert } from "lucide-react";
import type { Voucher } from "@/types/reward";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

// Voucher picker for checkout. Opens as a bottom sheet listing every active
// voucher as a selectable ticket. The one-time-use warning is folded inline
// above the "Use now" button, so applying is a single confirmed step (no extra
// modal). Eligibility mirrors the checkout discount rule: rm_off needs the cart
// to clear its min spend; free_drink is always eligible.
export function VoucherPickerSheet({
  open,
  onOpenChange,
  vouchers,
  cartTotal,
  selectedVoucherId,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vouchers: Voucher[];
  cartTotal: number;
  selectedVoucherId: string | null;
  onApply: (voucherId: string) => void;
}) {
  // Draft selection inside the sheet — only committed to the parent on "Use
  // now", so backing out leaves the applied voucher unchanged. Re-seeded from the
  // live selection whenever the sheet transitions to open (adjusting state during
  // render, per React's "you might not need an effect" guidance).
  const [pickedId, setPickedId] = useState<string | null>(selectedVoucherId);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPickedId(selectedVoucherId);
  }

  const isEligible = (v: Voucher) =>
    v.type === "free_drink" || cartTotal >= v.minSpend;

  const picked = vouchers.find((v) => v.id === pickedId) ?? null;
  const canUse = Boolean(picked) && isEligible(picked!);

  function use() {
    if (!picked || !canUse) return;
    onApply(picked.id);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        // z-[60] so the sheet (and its "Use now" bar) sits above the fixed tab
        // bar (z-[55]); otherwise the tab bar covers the bottom action button.
        className="z-[60] mx-auto flex max-h-[85vh] w-full max-w-md flex-col gap-0 rounded-t-3xl p-0"
      >
        <div className="shrink-0 px-5 pb-3 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
          <SheetTitle className="font-heading text-lg font-bold tracking-tight">
            Your vouchers
          </SheetTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pick one to use on this order.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <ul className="flex flex-col gap-2.5">
            {vouchers.map((v) => {
              const eligible = isEligible(v);
              const isFree = v.type === "free_drink";
              const headline = isFree
                ? "Free Drink"
                : `${formatPrice(v.discountAmount)} Off`;
              const sub = isFree
                ? `Cheapest drink free · up to ${formatPrice(v.freeDrinkMaxValue)}`
                : `Min spend ${formatPrice(v.minSpend)}`;
              const checked = pickedId === v.id;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    disabled={!eligible}
                    onClick={() => setPickedId(checked ? null : v.id)}
                    aria-pressed={checked}
                    className={cn(
                      // Ticket: icon stub + body split by a notched seam, matching
                      // the My Vouchers list on the profile screen.
                      "relative flex w-full items-stretch overflow-hidden rounded-2xl text-left outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50",
                      checked
                        ? "bg-black text-white"
                        : "border border-border bg-white text-foreground",
                      eligible ? "hover:scale-[1.01] active:scale-[0.99]" : "opacity-50",
                    )}
                  >
                    <div
                      className={cn(
                        "flex w-14 shrink-0 items-center justify-center",
                        checked ? "bg-white/10" : "bg-neutral-100",
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
                        <p className="font-heading text-base font-bold uppercase tracking-wide">
                          {headline}
                        </p>
                        <p
                          className={cn(
                            "text-[0.6875rem]",
                            checked ? "text-white/60" : "text-muted-foreground",
                          )}
                        >
                          {sub}
                        </p>
                      </div>
                      {checked ? (
                        <span
                          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-black"
                          aria-hidden
                        >
                          <Check className="size-4" strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="shrink-0 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                          {eligible ? "Select" : "Spend more"}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Confirm bar — inline one-time-use warning + Use now. */}
        <div className="shrink-0 border-t border-border px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5">
          <div className="mb-3 flex w-full items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-left">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-amber-500"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-xs leading-snug text-amber-900">
              Vouchers are one-time use. Once you place this order the voucher is
              used up &mdash; if the order is later cancelled, it is{" "}
              <span className="font-semibold">not refunded</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={use}
            disabled={!canUse}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-black px-4 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            <Ticket className="size-4" strokeWidth={2} aria-hidden />
            <span className="text-xs font-bold uppercase tracking-wider">
              Use now
            </span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
