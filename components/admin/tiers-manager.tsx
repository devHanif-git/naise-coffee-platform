"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AdminTier } from "@/lib/rewards/types";
import { saveTier, setTierArchived } from "@/app/(admin)/admin/rewards/actions";

export function TiersManager({ initial }: { initial: AdminTier[] }) {
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("");
  const [perk, setPerk] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function reload() { startTransition(() => window.location.reload()); }
  function add() {
    setError(null);
    startTransition(async () => {
      const res = await saveTier({ name, threshold: Number(threshold || "0"), perk });
      if (res.ok) { setName(""); setThreshold(""); setPerk(""); reload(); } else setError(res.error);
    });
  }

  const activeCount = initial.filter((t) => !t.isArchived).length;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-base font-semibold">Tiers</h2>
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {activeCount} active
        </span>
      </div>
      {initial.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
          No tiers yet. Add your first below.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {initial.map((t) => <TierRow key={t.id} tier={t} onChanged={reload} />)}
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <Label>New tier</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1" />
          <Input inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Beans" className="w-24 font-mono tabular-nums" />
        </div>
        <Input value={perk} onChange={(e) => setPerk(e.target.value)} placeholder="Perk description" />
        <Button onClick={add} className="self-start rounded-full">Add tier</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

function TierRow({ tier, onChanged }: { tier: AdminTier; onChanged: () => void }) {
  const [name, setName] = useState(tier.name);
  const [threshold, setThreshold] = useState(String(tier.threshold));
  const [perk, setPerk] = useState(tier.perk);
  const [, startTransition] = useTransition();

  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-card p-3", tier.isArchived && "opacity-60")}>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
        <div className="relative w-28">
          <Input inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-full pr-12 font-mono tabular-nums" />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Beans</span>
        </div>
      </div>
      <Input value={perk} onChange={(e) => setPerk(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => startTransition(async () => { await setTierArchived(tier.id, !tier.isArchived); onChanged(); })}>
          {tier.isArchived ? "Restore" : "Archive"}
        </Button>
        <Button size="sm" className="flex-1 rounded-full" onClick={() => startTransition(async () => { await saveTier({ id: tier.id, name, threshold: Number(threshold || "0"), perk }); onChanged(); })}>
          Save
        </Button>
      </div>
    </div>
  );
}
