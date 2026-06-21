"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/admin/image-upload";
import type { AdminRewardItem } from "@/lib/rewards/types";
import type { AdminProduct } from "@/lib/menu/types";
import { saveRewardItem, setRewardActive, setRewardArchived } from "@/app/(admin)/admin/rewards/actions";

export function RewardCatalogManager({
  initial, products,
}: { initial: AdminRewardItem[]; products: AdminProduct[] }) {
  const [, startTransition] = useTransition();
  function reload() { startTransition(() => window.location.reload()); }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <h2 className="font-heading text-base font-semibold">Reward catalog</h2>
      <div className="flex flex-col gap-2">
        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rewards yet. Add your first reward below.</p>
        ) : (
          initial.map((r) => <RewardRow key={r.id} reward={r} products={products} onChanged={reload} />)
        )}
      </div>
      <div className="border-t border-border pt-3">
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
      <Button onClick={save} className="self-start">{reward ? "Save" : "Add reward"}</Button>
    </div>
  );
}

function RewardRow({
  reward, products, onChanged,
}: { reward: AdminRewardItem; products: AdminProduct[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <div className={cn("rounded-xl border border-border bg-card p-3", reward.isArchived && "opacity-50")}>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-semibold">{reward.name}</span>
          <span className="text-xs text-muted-foreground"><span className="font-mono tabular-nums">{reward.cost.toLocaleString()}</span> Beans · {reward.productName}</span>
        </div>
        <label className="flex flex-col items-center gap-1 text-xs font-medium text-muted-foreground">
          Active
          <Switch checked={reward.isActive} onCheckedChange={(v) => startTransition(async () => { await setRewardActive(reward.id, v); onChanged(); })} />
        </label>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Edit"}</Button>
      </div>
      <div className="mt-2 flex justify-end">
        <Button variant="outline" size="sm" onClick={() => startTransition(async () => { await setRewardArchived(reward.id, !reward.isArchived); onChanged(); })}>
          {reward.isArchived ? "Restore" : "Archive"}
        </Button>
      </div>
      {open && <div className="mt-3 border-t border-border pt-3"><RewardEditor reward={reward} products={products} onChanged={onChanged} /></div>}
    </div>
  );
}
