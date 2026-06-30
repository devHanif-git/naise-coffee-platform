// components/store/custom-line-builder.tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useCart } from "@/store/cart";
import { capitalizeWords } from "@/lib/format";
import { filterDecimal } from "@/lib/input";
import { StorePasscodePrompt } from "@/components/store/store-passcode-prompt";

// Staff-gated "add an off-menu drink" control for the kiosk cart. /store is
// customer self-serve, so the free-form PRICE field must not be open to
// customers — tapping "Add custom drink" first asks for the store passcode
// (the same prompt used to enter store mode). On success the form unlocks for
// the rest of this sheet's lifetime (local state); the staff member types a
// name + RM price + quantity and it joins the SAME cart as menu lines.
//
// Custom lines carry no product, so they key on `custom:<name>:<sen>` (see
// buildKey in store/cart.tsx) — two different custom drinks stay separate, a
// repeat of the same name+price merges.
export function CustomLineBuilder() {
  const { addItem } = useCart();
  const [unlocked, setUnlocked] = useState(false);
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(""); // MYR text input
  const [qty, setQty] = useState(1);

  const sen = Math.round(parseFloat(price) * 100);
  const canAdd = name.trim() !== "" && Number.isFinite(sen) && sen > 0 && qty >= 1;

  function add() {
    if (!canAdd) return;
    const trimmed = name.trim();
    addItem({
      productId: `custom:${trimmed}:${sen}`,
      name: trimmed,
      addonIds: [],
      addonNames: [],
      unitPrice: sen,
      unitOriginalPrice: sen,
      isCustom: true,
      quantity: qty,
    });
    setName("");
    setPrice("");
    setQty(1);
  }

  // Collapsed: a single row that opens the passcode prompt.
  if (!unlocked) {
    return (
      <div className="py-4">
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm font-semibold text-muted-foreground transition-colors hover:bg-neutral-50"
        >
          <Plus className="size-4" aria-hidden />
          Add custom drink
        </button>

        {asking && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-6">
            <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-white p-5 text-center">
              <h2 className="font-heading text-base font-semibold">Staff unlock</h2>
              <p className="text-xs text-muted-foreground">
                Enter the store passcode to add an off-menu drink with a custom price.
              </p>
              <StorePasscodePrompt
                onCancel={() => setAsking(false)}
                onSuccess={() => {
                  setUnlocked(true);
                  setAsking(false);
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Unlocked: the name + price + qty form.
  return (
    <div className="flex flex-col gap-2 py-4">
      <h3 className="text-xs font-bold uppercase tracking-wide">Custom drink</h3>
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
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            aria-label="Decrease quantity"
            className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100"
          >
            <span aria-hidden className="text-lg leading-none">−</span>
          </button>
          <span className="w-6 text-center text-sm font-bold tabular-nums">{qty}</span>
          <button
            type="button"
            onClick={() => setQty((q) => q + 1)}
            aria-label="Increase quantity"
            className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          className="h-11 flex-1 rounded-2xl bg-black text-sm font-semibold text-white transition-opacity disabled:opacity-40"
        >
          Add to cart
        </button>
      </div>
    </div>
  );
}
