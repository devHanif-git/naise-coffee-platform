"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { images } from "@/constants/images";
import { SmartImage } from "@/components/ui/smart-image";
import { ImageUpload } from "@/components/admin/image-upload";
import type { AdminRewardItem } from "@/lib/rewards/types";
import type { AdminProduct } from "@/lib/menu/types";
import { saveRewardItem, setRewardActive, setRewardArchived } from "@/app/(admin)/admin/rewards/actions";

export function RewardCatalogManager({
  initial, products,
}: { initial: AdminRewardItem[]; products: AdminProduct[] }) {
  const [, startTransition] = useTransition();
  function reload() { startTransition(() => window.location.reload()); }

  const activeCount = initial.filter((r) => r.isActive && !r.isArchived).length;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-base font-semibold">Reward catalog</h2>
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {activeCount} live
        </span>
      </div>
      {initial.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
          No rewards yet. Add your first below.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {initial.map((r) => <RewardRow key={r.id} reward={r} products={products} onChanged={reload} />)}
        </div>
      )}
      <div className="border-t border-border pt-4">
        <RewardEditor products={products} onChanged={reload} />
      </div>
    </section>
  );
}

function RewardEditor({
  reward, products, onChanged,
}: { reward?: AdminRewardItem; products: AdminProduct[]; onChanged: () => void }) {
  const [name, setName] = useState(reward?.name ?? "");
  const [cost, setCost] = useState(reward ? String(reward.cost) : "");
  const [productId, setProductId] = useState(reward?.productId ?? products[0]?.id ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(reward?.imageUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveRewardItem({ id: reward?.id, name, cost: Number(cost || "0"), productId, imageUrl });
      if (res.ok) { if (!reward) { setName(""); setCost(""); setImageUrl(null); } onChanged(); }
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{reward ? "Edit reward" : "New reward"}</Label>
      <ImageUpload value={imageUrl} onChange={setImageUrl} />
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1" />
        <Input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Beans" className="w-24 font-mono tabular-nums" />
      </div>
      <select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
        {products.filter((p) => !p.isArchived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={save} className="self-start rounded-full">{reward ? "Save" : "Add reward"}</Button>
    </div>
  );
}

function RewardRow({
  reward, products, onChanged,
}: { reward: AdminRewardItem; products: AdminProduct[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-3", reward.isArchived && "opacity-60")}>
      <div className="flex items-center gap-3">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
          <SmartImage
            src={reward.imageUrl ?? images.coffeeWithLogo}
            alt={reward.name}
            fill
            sizes="48px"
            className="object-contain"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 truncate text-sm font-semibold">
            {reward.name}
            {reward.isArchived && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Archived
              </span>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            <span className="font-mono font-medium tabular-nums text-foreground">{reward.cost.toLocaleString()}</span> Beans · {reward.productName}
          </span>
        </div>
        <Switch
          checked={reward.isActive}
          aria-label={`${reward.name} active`}
          onCheckedChange={(v) => startTransition(async () => { await setRewardActive(reward.id, v); onChanged(); })}
        />
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Edit"}</Button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          <RewardEditor reward={reward} products={products} onChanged={onChanged} />
          <Button variant="outline" size="sm" className="self-start rounded-full" onClick={() => startTransition(async () => { await setRewardArchived(reward.id, !reward.isArchived); onChanged(); })}>
            {reward.isArchived ? "Restore" : "Archive"}
          </Button>
        </div>
      )}
    </div>
  );
}
