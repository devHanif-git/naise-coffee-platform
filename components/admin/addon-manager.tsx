"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AdminBackLink } from "@/components/admin/admin-back-link";
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
      <AdminBackLink href="/admin/menu" label="Back to Menu" />
      <h1 className="font-heading text-lg font-bold tracking-tight">Add-ons</h1>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Oat Milk"
          />
        </div>
        <div className="flex w-full flex-col gap-1.5 sm:w-24">
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
          className="w-full rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white sm:w-auto"
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
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-border p-3 sm:flex-row sm:items-center",
        addon.isArchived && "opacity-50",
      )}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full sm:flex-1"
      />
      <Input
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        className="w-full sm:w-20"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const res = await saveAddon({ id: addon.id, name, price: toSen(price) });
                if (!res.ok) return setError(res.error);
                onChanged();
              } catch {
                setError("Couldn't save. Please try again.");
              }
            });
          }}
          className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white"
        >
          Save
        </button>
        <button
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const res = await setAddonArchived(addon.id, !addon.isArchived);
                if (!res.ok) return setError(res.error);
                onChanged();
              } catch {
                setError("Couldn't update. Please try again.");
              }
            });
          }}
          className="text-[0.625rem] font-semibold text-muted-foreground underline"
        >
          {addon.isArchived ? "Restore" : "Archive"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600 sm:w-full">{error}</p>}
    </div>
  );
}
