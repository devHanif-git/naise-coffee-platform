"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AdminBackLink } from "@/components/admin/admin-back-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
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
    <div className="flex flex-col gap-6">
      <AdminBackLink href="/admin/menu" label="Back to Menu" />
      <AdminPageHeader
        title="Add-ons"
        description="Create and price add-ons available across menu categories."
      />

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-heading text-base font-semibold">New add-on</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-addon-name">Name</Label>
            <Input
              id="new-addon-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Oat Milk"
            />
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-24">
            <Label htmlFor="new-addon-price">Price</Label>
            <Input
              id="new-addon-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="font-mono tabular-nums"
            />
          </div>
          <Button onClick={add} className="w-full sm:w-auto">
            Add
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {initial.length === 0 ? (
        <p className="text-sm text-muted-foreground">No add-ons yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {initial.map((a) => (
            <AddonRow key={a.id} addon={a} onChanged={reload} />
          ))}
        </div>
      )}
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
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4",
        addon.isArchived && "opacity-50",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full sm:flex-1"
        />
        <Input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-full font-mono tabular-nums sm:w-20"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const res = await saveAddon({
                  id: addon.id,
                  name,
                  price: toSen(price),
                });
                if (!res.ok) return setError(res.error);
                onChanged();
              } catch {
                setError("Couldn't save. Please try again.");
              }
            });
          }}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
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
        >
          {addon.isArchived ? "Restore" : "Archive"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
