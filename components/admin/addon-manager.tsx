"use client";

import { useState, useTransition } from "react";
import { PendingButton } from "@/components/ui/pending-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { filterDecimal } from "@/lib/input";
import { capitalizeWords } from "@/lib/format";
import { AdminBackLink } from "@/components/admin/admin-back-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { useUnsavedChanges } from "@/components/admin/unsaved-changes";
import type { AdminAddon } from "@/lib/menu/types";
import { saveAddon, setAddonArchived } from "@/app/(admin)/admin/addons/actions";

const toSen = (rm: string) => Math.round(parseFloat(rm || "0") * 100);
const toRm = (sen: number) => (sen / 100).toFixed(2);

export function AddonManager({ initial }: { initial: AdminAddon[] }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A partially-typed new add-on is unsaved work; reloads on save.
  useUnsavedChanges(name.trim() !== "" || price.trim() !== "");

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

  const active = initial.filter((a) => !a.isArchived);
  const archived = initial.filter((a) => a.isArchived);

  return (
    <div className="flex flex-col gap-6">
      <AdminBackLink href="/admin/menu" label="Back to Menu" />
      <AdminPageHeader
        title="Add-ons"
        description="Create and price add-ons available across menu categories."
      />

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="font-heading text-base font-semibold">New add-on</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-addon-name">Name</Label>
            <Input
              id="new-addon-name"
              value={name}
              onChange={(e) => setName(capitalizeWords(e.target.value))}
              placeholder="e.g. Oat Milk"
            />
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-28">
            <Label htmlFor="new-addon-price">Price (RM)</Label>
            <Input
              id="new-addon-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(filterDecimal(e.target.value, price))}
              placeholder="0.00"
              className="font-mono tabular-nums"
            />
          </div>
          <PendingButton
            pending={pending}
            onClick={add}
            className="w-full rounded-full sm:w-auto"
          >
            {pending ? "Adding…" : "Add add-on"}
          </PendingButton>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base font-semibold">All add-ons</h2>
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {active.length} active · {archived.length} archived
          </span>
        </div>
        {initial.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-12 text-center text-sm text-muted-foreground">
            No add-ons yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {[...active, ...archived].map((a) => (
              <AddonRow key={a.id} addon={a} onChanged={reload} />
            ))}
          </div>
        )}
      </section>
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
  const [pending, startTransition] = useTransition();

  // Reloads on save (onChanged), so compare directly to the addon prop.
  useUnsavedChanges(name !== addon.name || price !== toRm(addon.price));

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border bg-card p-4",
        addon.isArchived && "opacity-60",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={name}
          onChange={(e) => setName(capitalizeWords(e.target.value))}
          className="w-full sm:flex-1"
        />
        <div className="relative w-full sm:w-24">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            RM
          </span>
          <Input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(filterDecimal(e.target.value, price))}
            className="w-full pl-9 font-mono tabular-nums"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {addon.isArchived && (
          <span className="mr-auto rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Archived
          </span>
        )}
        <PendingButton
          pending={pending}
          size="sm"
          className="rounded-full"
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
          {pending ? "Saving…" : "Save"}
        </PendingButton>
        <PendingButton
          pending={pending}
          variant="ghost"
          size="sm"
          className="rounded-full"
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
        </PendingButton>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
