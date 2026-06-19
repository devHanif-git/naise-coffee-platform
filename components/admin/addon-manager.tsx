"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AdminAddon } from "@/lib/menu/types";
import { saveAddon, setAddonArchived } from "@/app/(admin)/admin/addons/actions";

const toSen = (rm: string) => Math.round(parseFloat(rm || "0") * 100);
const toRm = (sen: number) => (sen / 100).toFixed(2);

export function AddonManager({ initial }: { initial: AdminAddon[] }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function reload() {
    startTransition(() => window.location.reload());
  }

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await saveAddon({ name, price: toSen(price) });
      if (res.ok) {
        setName("");
        setPrice("");
        reload();
      } else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Add-ons</h1>

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Oat Milk"
          />
        </div>
        <div className="flex w-24 flex-col gap-1.5">
          <Label>Price</Label>
          <Input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <button
          onClick={add}
          className="rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white"
        >
          Add
        </button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex flex-col gap-2">
        {initial.map((a) => (
          <AddonRow key={a.id} addon={a} onChanged={reload} />
        ))}
      </div>
    </div>
  );
}

function AddonRow({
  addon,
  onChanged,
}: {
  addon: AdminAddon;
  onChanged: () => void;
}) {
  const [name, setName] = useState(addon.name);
  const [price, setPrice] = useState(toRm(addon.price));
  const [, startTransition] = useTransition();

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl border border-border p-3",
        addon.isArchived && "opacity-50",
      )}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
      <Input
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        className="w-20"
      />
      <button
        onClick={() =>
          startTransition(async () => {
            await saveAddon({ id: addon.id, name, price: toSen(price) });
            onChanged();
          })
        }
        className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white"
      >
        Save
      </button>
      <button
        onClick={() =>
          startTransition(async () => {
            await setAddonArchived(addon.id, !addon.isArchived);
            onChanged();
          })
        }
        className="text-[0.625rem] font-semibold text-muted-foreground underline"
      >
        {addon.isArchived ? "Restore" : "Archive"}
      </button>
    </div>
  );
}
