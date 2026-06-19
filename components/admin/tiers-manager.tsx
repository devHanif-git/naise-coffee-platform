"use client";

import { useState, useTransition } from "react";
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

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <h2 className="font-heading text-base font-bold tracking-tight">Tiers</h2>
      <div className="flex flex-col gap-2">
        {initial.map((t) => <TierRow key={t.id} tier={t} onChanged={reload} />)}
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Label>New tier</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1" />
          <Input inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Beans" className="w-24" />
        </div>
        <Input value={perk} onChange={(e) => setPerk(e.target.value)} placeholder="Perk description" />
        <button onClick={add} className="self-start rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white">Add tier</button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </section>
  );
}

function TierRow({ tier, onChanged }: { tier: AdminTier; onChanged: () => void }) {
  const [name, setName] = useState(tier.name);
  const [threshold, setThreshold] = useState(String(tier.threshold));
  const [perk, setPerk] = useState(tier.perk);
  const [, startTransition] = useTransition();

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border border-border p-3", tier.isArchived && "opacity-50")}>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
        <Input inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-24" />
      </div>
      <Input value={perk} onChange={(e) => setPerk(e.target.value)} />
      <div className="flex gap-2">
        <button onClick={() => startTransition(async () => { await setTierArchived(tier.id, !tier.isArchived); onChanged(); })}
          className="rounded-xl border border-border px-3 py-1.5 text-xs font-semibold">{tier.isArchived ? "Restore" : "Archive"}</button>
        <button onClick={() => startTransition(async () => { await saveTier({ id: tier.id, name, threshold: Number(threshold || "0"), perk }); onChanged(); })}
          className="flex-1 rounded-xl bg-black py-1.5 text-xs font-semibold text-white">Save</button>
      </div>
    </div>
  );
}
