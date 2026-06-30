"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { filterDigits } from "@/lib/input";
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
  expired: "bg-muted text-muted-foreground",
  off: "bg-muted text-muted-foreground",
};

export function PromotionsManager({
  initial, products, categories,
}: { initial: AdminPromotion[]; products: AdminProduct[]; categories: AdminCategory[] }) {
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();
  function reload() { startTransition(() => window.location.reload()); }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Promotions"
        description="Create discounts and schedule when they run."
      >
        <Button onClick={() => setCreating((v) => !v)} size="sm" className="rounded-full">
          {creating ? "Close" : "New promotion"}
        </Button>
      </AdminPageHeader>

      {creating && (
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h2 className="font-heading text-base font-semibold">New promotion</h2>
          <PromotionEditor products={products} categories={categories}
            onDone={() => { setCreating(false); reload(); }} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base font-semibold">All promotions</h2>
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {initial.length} total
          </span>
        </div>
        {initial.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-12 text-center text-sm text-muted-foreground">
            No promotions yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {initial.map((p) => (
              <PromotionRow key={p.id} promo={p} products={products} categories={categories} onChanged={reload} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PromotionRow({
  promo, products, categories, onChanged,
}: { promo: AdminPromotion; products: AdminProduct[]; categories: AdminCategory[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const status = promotionStatus(promo, new Date());
  const window = promo.startsAt || promo.endsAt
    ? `${promo.startsAt ? new Date(promo.startsAt).toLocaleDateString() : "Any"} to ${promo.endsAt ? new Date(promo.endsAt).toLocaleDateString() : "Any"}`
    : "Always";

  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-3">
        <span className="flex shrink-0 flex-col items-center justify-center rounded-xl bg-foreground px-2.5 py-1.5 leading-none text-background">
          <span className="font-mono text-base font-bold tabular-nums">{promo.percentOff}%</span>
          <span className="mt-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-background/70">off</span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{promo.label}</span>
          <span className="text-xs text-muted-foreground">{window}</span>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide", STATUS_STYLE[status])}>{status}</span>
        <Switch
          checked={promo.isActive}
          disabled={pending}
          aria-label={`${promo.label} active`}
          onCheckedChange={(v) => startTransition(async () => { await setPromotionActive(promo.id, v); onChanged(); })}
        />
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Edit"}</Button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          <PromotionEditor promo={promo} products={products} categories={categories} onDone={onChanged} />
          <PendingButton
            pending={pending}
            variant="destructive"
            size="sm"
            onClick={() => startTransition(async () => { await deletePromotion(promo.id); onChanged(); })}
            className="self-start rounded-full"
          >
            {pending ? "Deleting…" : <><Trash2 className="size-3.5" /> Delete promotion</>}
          </PendingButton>
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
        <Input inputMode="numeric" value={percentOff} onChange={(e) => setPercentOff(filterDigits(e.target.value))} placeholder="% off" className="w-20" />
      </div>
      <label className="flex items-center justify-between text-sm font-medium">
        <span>Active</span>
        <Switch checked={isActive} onCheckedChange={setIsActive} />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5"><Label>Starts (optional)</Label>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-full min-w-0" /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5"><Label>Ends (optional)</Label>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full min-w-0" /></div>
      </div>

      <p className="text-xs text-muted-foreground">
        Leave both lists empty to apply the discount store-wide.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
          <div className="flex items-baseline justify-between">
            <Label>Categories</Label>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{categoryIds.size} selected</span>
          </div>
          {categories.filter((c) => !c.isArchived).length === 0 ? (
            <p className="text-sm text-muted-foreground">None available.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {categories.filter((c) => !c.isArchived).map((c) => {
                const on = categoryIds.has(c.id);
                return (
                  <label key={c.id} className="flex cursor-pointer items-center gap-3 py-2 text-sm">
                    <input type="checkbox" checked={on} onChange={() => toggle(categoryIds, c.id, setCategoryIds)} className="size-4 accent-foreground rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50" />
                    <span className={cn(!on && "text-muted-foreground")}>{c.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
          <div className="flex items-baseline justify-between">
            <Label>Products</Label>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{productIds.size} selected</span>
          </div>
          {products.filter((p) => !p.isArchived).length === 0 ? (
            <p className="text-sm text-muted-foreground">None available.</p>
          ) : (
            <div className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto">
              {products.filter((p) => !p.isArchived).map((p) => {
                const on = productIds.has(p.id);
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 py-2 text-sm">
                    <input type="checkbox" checked={on} onChange={() => toggle(productIds, p.id, setProductIds)} className="size-4 accent-foreground rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50" />
                    <span className={cn(!on && "text-muted-foreground")}>{p.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={save} disabled={pending} className="self-start rounded-full">
        {pending ? "Saving..." : promo ? "Save promotion" : "Add promotion"}
      </Button>
    </div>
  );
}
