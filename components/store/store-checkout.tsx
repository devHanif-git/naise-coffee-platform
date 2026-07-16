"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Trash2 } from "lucide-react";
import { SmartImage } from "@/components/ui/smart-image";
import { useCart } from "@/store/cart";
import { useRepriceCart } from "@/hooks/use-reprice-cart";
import { formatPrice } from "@/lib/format";
import { images } from "@/constants/images";
import { STORE_CONFIRMATION_RESET_MS, STORE_CONFIRMATION_RESET_HOLD_MS } from "@/constants/store";
import { placeStoreOrder, attachStoreMember } from "@/app/(store)/store/(kiosk)/actions";
import type { CartItem } from "@/types/cart";

type Method = "cash" | "duitnow-qr" | "unpaid";

export function StoreCheckout({
  cashOk,
  qrOk,
  payLaterEnabled,
  qrUrl,
  closedMessage,
}: {
  cashOk: boolean;
  qrOk: boolean;
  payLaterEnabled: boolean;
  qrUrl: string | null;
  closedMessage: string | null;
}) {
  const router = useRouter();
  const { items, totalPrice, notes, clear, incrementItem, decrementItem, removeItem } = useCart();
  const reprice = useRepriceCart();
  const [method, setMethod] = useState<Method | null>(cashOk ? "cash" : qrOk ? "duitnow-qr" : null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ orderNumber: string; token: string } | null>(null);
  // Set when emptying the cart from here needs a confirmation — pressing minus on
  // the last unit, or removing the only line. On confirm we clear and route back
  // to the menu (mirrors the customer cart sheet's clear-cart dialog).
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Bumps on every keystroke while the customer types their member details. null
  // means they haven't started — the confirmation uses the short idle reset. Once
  // they start, it holds a value and each keystroke restarts the long window so
  // the kiosk only resets after ~3 min of no typing (not the instant 15s).
  const [typingAt, setTypingAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-price against the live catalogue once on mount, so a promotion toggled in
  // the CMS since a drink was added shows the current price here without a page
  // refresh. Mount-only (empty deps): reprice() reads the current cart itself and
  // no-ops when nothing changed, so we don't need it in the deps. The server
  // re-prices authoritatively at placement regardless.
  useEffect(() => {
    void reprice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confirmation auto-resets to the menu for the next customer. If the customer
  // is mid-way through adding member details, use the long hold window and let
  // each keystroke (via typingAt changing) restart it.
  useEffect(() => {
    if (!placed) return;
    const delay =
      typingAt === null ? STORE_CONFIRMATION_RESET_MS : STORE_CONFIRMATION_RESET_HOLD_MS;
    const t = setTimeout(() => {
      clear();
      router.push("/store");
    }, delay);
    return () => clearTimeout(t);
  }, [placed, typingAt, clear, router]);

  if (placed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">Order placed</p>
        <p className="font-heading text-4xl font-bold">{placed.orderNumber}</p>
        <p className="text-sm text-muted-foreground">Show this number at the counter.</p>
        <StoreAttachMember
          token={placed.token}
          onType={() => setTypingAt((n) => (n === null ? 0 : n + 1))}
          onResolved={() => setTypingAt(null)}
        />
        <button type="button" onClick={() => { clear(); router.push("/store"); }} className="mt-4 h-12 rounded-2xl bg-black px-6 text-sm font-semibold text-white">
          Start new order
        </button>
      </div>
    );
  }

  if (closedMessage) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">{closedMessage}</p>
      </div>
    );
  }

  function submit() {
    if (!method) return;
    setError(null);
    startTransition(async () => {
      const res = await placeStoreOrder({
        items: items.map((i) => ({
          // Custom lines carry a synthetic cart key in productId; never send it
          // to the server — omit it so the availability check only sees real ids.
          productId: i.isCustom ? undefined : i.productId,
          name: i.name,
          quantity: i.quantity,
          // Sent so the server can re-price menu lines against the live
          // catalogue. Omitted for custom (off-menu) lines — they have no product.
          sizeId: i.isCustom ? undefined : i.sizeId,
          addonIds: i.isCustom ? undefined : i.addonIds,
          sizeName: i.sizeName,
          addonNames: i.addonNames,
          unitPrice: i.unitPrice,
          isCustom: i.isCustom,
        })),
        paymentMethod: method,
        notes: notes || undefined,
        subtotal: totalPrice,
        total: totalPrice,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Clear the cart the moment the order is placed — not later on the button
      // or the auto-reset timer. Otherwise pressing back from the confirmation
      // unmounts this screen with the cart still full, and those items linger
      // into the next customer's order. (Mirrors the customer checkout, which
      // clears at placement.) The confirmation view reads only the order number
      // and token, so clearing here doesn't affect it.
      setPlaced({ orderNumber: res.orderNumber, token: res.token });
      clear();
    });
  }

  // Pressing minus on the last unit, or removing the only line, would empty the
  // cart and leave the customer stranded on the checkout. Instead of doing it
  // silently, confirm first (mirrors the customer cart sheet); on confirm we
  // clear and route back to the menu. When other lines remain, just apply the
  // action — the cart isn't emptied, so no confirmation is needed.
  const isOnlyLine = items.length === 1;

  function handleDecrement(item: CartItem) {
    if (item.quantity <= 1 && isOnlyLine) {
      setConfirmingClear(true);
      return;
    }
    decrementItem(item.key);
  }

  function handleRemove(item: CartItem) {
    if (isOnlyLine) {
      setConfirmingClear(true);
      return;
    }
    removeItem(item.key);
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      {/* Order review — the checkout is where money changes hands, so it always
          shows what's being bought no matter which path got here. The kiosk's
          product-page Checkout button adds the drink and jumps straight here
          (skipping the menu's floating cart), so without this list a wrong or
          duplicate line would be invisible and paid for. Editing quantity or
          removing a line here is the fix for every variant of that. */}
      <section className="flex flex-col gap-2">
        <h1 className="font-heading text-lg font-bold uppercase tracking-wider">Order</h1>
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                {[item.sizeName, ...item.addonNames].filter(Boolean).length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">
                    {[item.sizeName, ...item.addonNames].filter(Boolean).join(", ")}
                  </p>
                )}
                <p className="text-xs font-medium">{formatPrice(item.unitPrice * item.quantity)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 p-1">
                <button type="button" aria-label={item.quantity <= 1 ? "Remove" : "Decrease"} onClick={() => handleDecrement(item)} className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-white">
                  <Minus className="size-4" />
                </button>
                <span className="w-6 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
                <button type="button" aria-label="Increase" onClick={() => incrementItem(item.key)} className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-white">
                  <Plus className="size-4" />
                </button>
              </div>
              <button type="button" aria-label={`Remove ${item.name}`} onClick={() => handleRemove(item)} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-rose-600">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <h2 className="font-heading text-lg font-bold uppercase tracking-wider">Pay</h2>

      <div className="flex flex-col gap-2">
        {cashOk && (
          <button type="button" onClick={() => setMethod("cash")} aria-pressed={method === "cash"} className={`h-14 rounded-2xl border text-sm font-semibold ${method === "cash" ? "border-black bg-black text-white" : "border-border bg-white"}`}>
            Cash
          </button>
        )}
        {qrOk && (
          <button type="button" onClick={() => setMethod("duitnow-qr")} aria-pressed={method === "duitnow-qr"} className={`h-14 rounded-2xl border text-sm font-semibold ${method === "duitnow-qr" ? "border-black bg-black text-white" : "border-border bg-white"}`}>
            DuitNow QR
          </button>
        )}
        {payLaterEnabled && (
          <button type="button" onClick={() => setMethod("unpaid")} aria-pressed={method === "unpaid"} className={`h-14 rounded-2xl border text-sm font-semibold ${method === "unpaid" ? "border-black bg-black text-white" : "border-border bg-white"}`}>
            Pay later
          </button>
        )}
        {!cashOk && !qrOk && !payLaterEnabled && (
          <p className="text-sm text-muted-foreground">Ordering is temporarily unavailable.</p>
        )}
      </div>

      {method === "duitnow-qr" && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-neutral-50 p-6">
          <div className="relative size-64">
            <SmartImage src={qrUrl ?? images.qrDuitnow} alt="DuitNow QR" fill sizes="256px" className="object-contain" />
          </div>
          <p className="text-sm text-muted-foreground">Scan to pay, then tap Place order.</p>
        </div>
      )}

      <div className="flex items-center justify-between text-base font-bold">
        <span>Total</span>
        <span>{formatPrice(totalPrice)}</span>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button type="button" onClick={submit} disabled={pending || !method || items.length === 0} className="h-14 rounded-2xl bg-black text-base font-semibold text-white disabled:opacity-40">
        Place order
      </button>

      {/* Clear-cart confirmation — mirrors the customer cart sheet. Fired when
          removing the last unit/line would empty the cart. On confirm we clear
          and route back to the menu; cancel keeps the item as-is. */}
      {confirmingClear && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="store-clear-title"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-6 naise-fade"
          onClick={() => setConfirmingClear(false)}
        >
          <div
            className="w-full max-w-xs rounded-3xl bg-white p-5 text-center shadow-2xl naise-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <Trash2 className="size-6" strokeWidth={2} aria-hidden />
            </div>
            <h3 id="store-clear-title" className="mt-3 font-heading text-lg font-bold tracking-tight">
              Clear your cart?
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              This removes all items from your cart. You can&rsquo;t undo this.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => { clear(); setConfirmingClear(false); router.push("/store"); }}
                className="flex h-11 w-full items-center justify-center rounded-2xl bg-rose-600 text-xs font-bold text-white transition-colors hover:bg-rose-700 outline-none focus-visible:ring-3 focus-visible:ring-rose-600/40"
              >
                Yes, clear cart
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="flex h-11 w-full items-center justify-center rounded-2xl border border-border bg-white text-xs font-bold text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Keep items
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Optional post-order step: staff key in the customer's phone/email to attach
// their member account so they earn a loyalty stamp. Uses the store-guarded
// attachStoreMember action (service-role under the store-mode gate). onInteract
// pauses the confirmation auto-reset while the customer types; onResolved
// re-arms it once the attach succeeds so the kiosk returns to the menu for the
// next customer.
function StoreAttachMember({
  token,
  onType,
  onResolved,
}: {
  token: string;
  onType: () => void;
  onResolved: () => void;
}) {
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) {
    return <p className="text-sm font-semibold text-emerald-600">{msg}</p>;
  }

  function attach() {
    if (!value.trim()) return;
    startTransition(async () => {
      const res = await attachStoreMember(token, value);
      if (res.ok) {
        setDone(true);
        setMsg(`Stamp added for ${res.displayName}.`);
        onResolved();
      } else {
        setMsg(res.error);
      }
    });
  }

  return (
    <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Add member for a stamp</p>
      <input
        value={value}
        onChange={(e) => { setValue(e.target.value); onType(); }}
        placeholder="Phone or email"
        disabled={pending}
        className="h-12 rounded-2xl border border-border px-4 text-center text-sm"
      />
      <button
        type="button"
        onClick={attach}
        disabled={pending || !value.trim()}
        className="h-12 rounded-2xl border border-black text-sm font-semibold disabled:opacity-40"
      >
        {pending ? "Adding" : "Add stamp"}
      </button>
      {msg && !done && <p className="text-sm text-rose-600">{msg}</p>}
    </div>
  );
}
