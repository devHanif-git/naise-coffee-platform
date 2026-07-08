"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SmartImage } from "@/components/ui/smart-image";
import { useCart } from "@/store/cart";
import { formatPrice } from "@/lib/format";
import { images } from "@/constants/images";
import { STORE_CONFIRMATION_RESET_MS } from "@/constants/store";
import { placeStoreOrder, attachStoreMember } from "@/app/(store)/store/(kiosk)/actions";

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
  const { items, totalPrice, notes, clear } = useCart();
  const [method, setMethod] = useState<Method | null>(cashOk ? "cash" : qrOk ? "duitnow-qr" : null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ orderNumber: string; token: string } | null>(null);
  // Set true once the customer starts adding member details on the confirmation
  // screen, so the auto-reset timer doesn't yank the page away mid-entry.
  const [holdReset, setHoldReset] = useState(false);
  const [pending, startTransition] = useTransition();

  // Confirmation auto-resets to the menu for the next customer — unless the
  // customer is mid-way through adding their member details for a stamp.
  useEffect(() => {
    if (!placed || holdReset) return;
    const t = setTimeout(() => {
      clear();
      router.push("/store");
    }, STORE_CONFIRMATION_RESET_MS);
    return () => clearTimeout(t);
  }, [placed, holdReset, clear, router]);

  if (placed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">Order placed</p>
        <p className="font-heading text-4xl font-bold">{placed.orderNumber}</p>
        <p className="text-sm text-muted-foreground">Show this number at the counter.</p>
        <StoreAttachMember token={placed.token} onInteract={() => setHoldReset(true)} />
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
      setPlaced({ orderNumber: res.orderNumber, token: res.token });
    });
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <h1 className="font-heading text-lg font-bold uppercase tracking-wider">Pay</h1>

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
    </div>
  );
}

// Optional post-order step: staff key in the customer's phone/email to attach
// their member account so they earn a loyalty stamp. Uses the store-guarded
// attachStoreMember action (service-role under the store-mode gate). Calling
// onInteract pauses the confirmation auto-reset so entry isn't interrupted.
function StoreAttachMember({
  token,
  onInteract,
}: {
  token: string;
  onInteract: () => void;
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
        onChange={(e) => { setValue(e.target.value); onInteract(); }}
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
