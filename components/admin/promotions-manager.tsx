"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { promotionStatus, type PromotionStatus } from "@/lib/promotions/pricing";
import type { AdminPromotion } from "@/lib/promotions/types";
import type { AdminProduct, AdminCategory } from "@/lib/menu/types";
import { savePromotion, setPromotionActive, deletePromotion } from "@/app/(admin)/admin/promotions/actions";

// datetime-local helpers: input value is local "YYYY-MM-DDTHH:mm".
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  return value.trim() === "" ? null : new Date(value).toISOString();
}

const STATUS_STYLE: Record<PromotionStatus, string> = {
  active: "bg-emerald-600 text-white",
  scheduled: "bg-amber-500 text-white",
  expired: "bg-neutral-300 text-neutral-700",
  off: "bg-neutral-200 text-neutral-500",
};

export function PromotionsManager({
  initial, products, categories,
}: { initial: AdminPromotion[]; products: AdminProduct[]; categories: AdminCategory[] }) {
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();
  function reload() { startTransition(() => window.location.reload()); }

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-lg font-bold tracking-tight">Promotions</h1>
        <button onClick={() => setCreating((v) => !v)} className="rounded-full bg-black px-3 py-1.5 text-xs font-semibold text-white">
          {creating ? "Close" : "New promotion"}
        </button>
      </div>

      {creating && (
        <PromotionEditor products={products} categories={categories}
          onDone={() => { setCreating(false); reload(); }} />
      )}

      <div className="flex flex-col gap-2">
        {initial.map((p) => (
          <PromotionRow key={p.id} promo={p} products={products} categories={categories} onChanged={reload} />
        ))}
        {initial.length === 0 && <p className="text-sm text-muted-foreground">No promotions yet.</p>}
      </div>
    </div>
  );
}

function PromotionRow({
  promo, products, categories, onChanged,
}: { promo: AdminPromotion; products: AdminProduct[]; categories: AdminCategory[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const status = promotionStatus(promo, new Date());
  const window = promo.startsAt || promo.endsAt
    ? `${promo.startsAt ? new Date(promo.startsAt).toLocaleDateString() : "—"} → ${promo.endsAt ? new Date(promo.endsAt).toLocaleDateString() : "—"}`
    : "Always";

  return (
    <div className="rounded-2xl border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-semibold">{promo.label} · {promo.percentOff}% off</span>
          <span className="text-xs text-muted-foreground">{window}</span>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase", STATUS_STYLE[status])}>{status}</span>
        <label className="flex flex-col items-center gap-1 text-[0.625rem] font-medium text-muted-foreground">
          On
          <Switch checked={promo.isActive} onCheckedChange={(v) => startTransition(async () => { await setPromotionActive(promo.id, v); onChanged(); })} />
        </label>
        <button onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-muted-foreground underline">{open ? "Close" : "Edit"}</button>
      </div>
      {open && (
        <div className="mt-3 border-t border-border pt-3">
          <PromotionEditor promo={promo} products={products} categories={categories} onDone={onChanged} />
          <button onClick={() => startTransition(async () => { await deletePromotion(promo.id); onChanged(); })}
            className="mt-2 flex items-center gap-1 text-[0.625rem] font-semibold text-rose-600">
            <Trash2 className="size-3.5" /> Delete promotion
          </button>
        </div>
      )}
    </div>
  );
}

function PromotionEditor({
  promo, products, categories, onDone,
}: { promo?: AdminPromotion; products: AdminProduct[]; categories: AdminCategory[]; onDone: () => void }) {
  const [label, setLabel] = useState(promo?.label ?? "");
  const [percentOff, setPercentOff] = useState(promo ? String(promo.percentOff) : "");
  const [isActive, setIsActive] = useState(promo?.isActive ?? true);
  const [startsAt, setStartsAt] = useState(toLocalInput(promo?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(promo?.endsAt ?? null));
  const [productIds, setProductIds] = useState<Set<string>>(new Set(promo?.productIds ?? []));
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set(promo?.categoryIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await savePromotion({
        id: promo?.id,
        label,
        percentOff: Number(percentOff || "0"),
        isActive,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
        productIds: [...productIds],
        categoryIds: [...categoryIds],
      });
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Flash Deal)" className="flex-1" />
        <Input inputMode="numeric" value={percentOff} onChange={(e) => setPercentOff(e.target.value)} placeholder="% off" className="w-20" />
      </div>
      <label className="flex items-center justify-between text-sm font-medium">
        <span>Active</span>
        <Switch checked={isActive} onCheckedChange={setIsActive} />
      </label>
      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5"><Label>Starts (optional)</Label>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
        <div className="flex flex-1 flex-col gap-1.5"><Label>Ends (optional)</Label>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Target categories</Label>
        {categories.filter((c) => !c.isArchived).map((c) => (
          <label key={c.id} className="flex items-center gap-3 py-1 text-sm">
            <input type="checkbox" checked={categoryIds.has(c.id)} onChange={() => toggle(categoryIds, c.id, setCategoryIds)} className="size-4" />
            <span>{c.name}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Target products</Label>
        {products.filter((p) => !p.isArchived).map((p) => (
          <label key={p.id} className="flex items-center gap-3 py-1 text-sm">
            <input type="checkbox" checked={productIds.has(p.id)} onChange={() => toggle(productIds, p.id, setProductIds)} className="size-4" />
            <span>{p.name}</span>
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button onClick={save} disabled={pending} className="self-start rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Saving…" : promo ? "Save promotion" : "Add promotion"}
      </button>
    </div>
  );
}
