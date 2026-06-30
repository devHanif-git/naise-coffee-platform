"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Minus, Plus, Trash2 } from "lucide-react";
import { SmartImage } from "@/components/ui/smart-image";
import { formatPrice, capitalizeFirst, capitalizeWords } from "@/lib/format";
import { filterDecimal } from "@/lib/input";
import { images } from "@/constants/images";
import type { CustomDrinkPreset } from "@/types/custom-order";
import { placeCustomOrder } from "@/app/(customer)/custom-order/actions";

type Method = "cash" | "duitnow-qr";
// id is a stable client-side key so React reconciles rows by identity, not by
// array index (which breaks focus/animation when a line is removed).
type Line = { id: number; name: string; unitPrice: number; quantity: number };

export function CustomOrderScreen({
  presets,
  cashOk,
  qrOk,
  qrUrl,
}: {
  presets: CustomDrinkPreset[];
  cashOk: boolean;
  qrOk: boolean;
  qrUrl: string | null;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(""); // MYR text input
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<Method | null>(cashOk ? "cash" : qrOk ? "duitnow-qr" : null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextId = useRef(0);

  const total = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  function addLine(n: string, sen: number) {
    const trimmed = n.trim();
    if (trimmed === "" || sen <= 0) return;
    setLines((prev) => [...prev, { id: nextId.current++, name: trimmed, unitPrice: sen, quantity: 1 }]);
  }

  function addManual() {
    const sen = Math.round(parseFloat(price) * 100);
    if (!name.trim() || !Number.isFinite(sen) || sen <= 0) return;
    addLine(name, sen);
    setName("");
    setPrice("");
  }

  function setQty(i: number, delta: number) {
    setLines((prev) =>
      prev
        .map((l, idx) => (idx === i ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity >= 1),
    );
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  function submit() {
    if (!method || lines.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await placeCustomOrder({
        items: lines.map((l) => ({ name: l.name, unitPrice: l.unitPrice, quantity: l.quantity })),
        paymentMethod: method,
        notes: notes || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlaced(res.orderNumber);
    });
  }

  if (placed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">Order placed</p>
        <p className="font-heading text-4xl font-bold">{placed}</p>
        <button
          type="button"
          onClick={() => {
            setLines([]);
            setNotes("");
            setMethod(cashOk ? "cash" : qrOk ? "duitnow-qr" : null);
            setPlaced(null);
          }}
          className="mt-4 h-12 rounded-2xl bg-black px-6 text-sm font-semibold text-white"
        >
          New custom order
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <button
          type="button"
          onClick={() => router.push("/profile")}
          aria-label="Go back"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">Custom Order</h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="flex flex-col gap-6 px-5 pb-8 pt-2">
        {/* Quick select */}
        {presets.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wide">Quick select</h2>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addLine(p.name, p.lastPrice)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-neutral-50"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{formatPrice(p.lastPrice)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Add a custom drink */}
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide">Add custom drink</h2>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(capitalizeWords(e.target.value))}
              placeholder="Drink name"
              className="h-12 flex-1 rounded-2xl border border-border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <input
              value={price}
              onChange={(e) => setPrice(filterDecimal(e.target.value, price))}
              inputMode="decimal"
              placeholder="RM"
              className="h-12 w-24 rounded-2xl border border-border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <button
            type="button"
            onClick={addManual}
            className="h-11 rounded-2xl bg-neutral-100 text-sm font-semibold transition-colors hover:bg-neutral-200"
          >
            Add to order
          </button>
        </section>

        {/* Lines */}
        {lines.length > 0 && (
          <section className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {lines.map((l, i) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{l.name}</span>
                  <span className="text-xs text-muted-foreground">{formatPrice(l.unitPrice)} each</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setQty(i, -1)} aria-label="Decrease" className="flex size-7 items-center justify-center rounded-full bg-neutral-100">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                  <button type="button" onClick={() => setQty(i, 1)} aria-label="Increase" className="flex size-7 items-center justify-center rounded-full bg-neutral-100">
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <button type="button" onClick={() => removeLine(i)} aria-label="Remove" className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-neutral-100">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </section>
        )}

        {/* Notes */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(capitalizeFirst(e.target.value))}
          placeholder="Notes (optional)"
          rows={2}
          className="rounded-2xl border border-border px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />

        {/* Payment */}
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide">Payment</h2>
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
            <p className="text-sm text-muted-foreground">No payment method is enabled. Enable one in Settings.</p>
          )}
          {method === "duitnow-qr" && (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-neutral-50 p-6">
              <div className="relative size-64">
                <SmartImage src={qrUrl ?? images.qrDuitnow} alt="DuitNow QR" fill sizes="256px" className="object-contain" />
              </div>
            </div>
          )}
        </section>

        <div className="flex items-center justify-between text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(total)}</span>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={pending || !method || lines.length === 0}
          className="h-14 rounded-2xl bg-black text-base font-semibold text-white disabled:opacity-40"
        >
          Place order
        </button>
      </main>
    </div>
  );
}
