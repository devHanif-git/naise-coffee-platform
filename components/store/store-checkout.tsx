"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SmartImage } from "@/components/ui/smart-image";
import { useCart } from "@/store/cart";
import { formatPrice } from "@/lib/format";
import { images } from "@/constants/images";
import { STORE_CONFIRMATION_RESET_MS } from "@/constants/store";
import { placeStoreOrder } from "@/app/(store)/store/(kiosk)/actions";

type Method = "cash" | "duitnow-qr";

export function StoreCheckout({
  cashOk,
  qrOk,
  qrUrl,
  closedMessage,
}: {
  cashOk: boolean;
  qrOk: boolean;
  qrUrl: string | null;
  closedMessage: string | null;
}) {
  const router = useRouter();
  const { items, totalPrice, notes, clear } = useCart();
  const [method, setMethod] = useState<Method | null>(cashOk ? "cash" : qrOk ? "duitnow-qr" : null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Confirmation auto-resets to the menu for the next customer.
  useEffect(() => {
    if (!placed) return;
    const t = setTimeout(() => {
      clear();
      router.push("/store");
    }, STORE_CONFIRMATION_RESET_MS);
    return () => clearTimeout(t);
  }, [placed, clear, router]);

  if (placed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">Order placed</p>
        <p className="font-heading text-4xl font-bold">{placed}</p>
        <p className="text-sm text-muted-foreground">Show this number at the counter.</p>
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
          productId: i.productId,
          name: i.name,
          quantity: i.quantity,
          sizeName: i.sizeName,
          addonNames: i.addonNames,
          unitPrice: i.unitPrice,
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
      setPlaced(res.orderNumber);
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
        {!cashOk && !qrOk && (
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
