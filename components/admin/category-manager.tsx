"use client";

import { useState, useTransition } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AdminBackLink } from "@/components/admin/admin-back-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import type { AdminAddon, AdminCategory } from "@/lib/menu/types";
import {
  saveCategory,
  reorderCategories,
  setCategoryArchived,
  setCategoryAddons,
} from "@/app/(admin)/admin/categories/actions";

export function CategoryManager({
  initial,
  addons,
}: {
  initial: AdminCategory[];
  addons: AdminAddon[];
}) {
  const [cats, setCats] = useState(initial);
  const [, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refreshFromServer() {
    startTransition(() => window.location.reload());
  }

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await saveCategory({ name: newName, maxAddons: 3 });
      if (res.ok) {
        setNewName("");
        refreshFromServer();
      } else setError(res.error);
    });
  }

  function move(i: number, dir: -1 | 1) {
    const prev = cats;
    const next = [...cats];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setCats(next);
    setError(null);
    startTransition(async () => {
      try {
        const res = await reorderCategories(next.map((c) => c.id));
        if (!res.ok) {
          setCats(prev);
          setError(res.error);
        }
      } catch {
        setCats(prev);
        setError("Couldn't reorder. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminBackLink href="/admin/menu" label="Back to Menu" />
      <AdminPageHeader
        title="Categories"
        description="Order, rename, and set default add-ons for each menu category."
      />

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="font-heading text-base font-semibold">New category</h2>
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-category">Name</Label>
            <Input
              id="new-category"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Pastries"
            />
          </div>
          <Button onClick={add} className="rounded-full">
            Add category
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base font-semibold">Display order</h2>
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Top shows first
          </span>
        </div>
        {cats.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-12 text-center text-sm text-muted-foreground">
            No categories yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {cats.map((c, i) => (
              <CategoryRow
                key={c.id}
                index={i}
                category={c}
                addons={addons}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                isFirst={i === 0}
                isLast={i === cats.length - 1}
                onChanged={refreshFromServer}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CategoryRow({
  index,
  category,
  addons,
  onUp,
  onDown,
  isFirst,
  isLast,
  onChanged,
}: {
  index: number;
  category: AdminCategory;
  addons: AdminAddon[];
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(category.name);
  const [maxAddons, setMaxAddons] = useState(String(category.maxAddons));
  const [picked, setPicked] = useState<Set<string>>(new Set(category.addonIds));
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const saveRes = await saveCategory({
          id: category.id,
          name,
          maxAddons: Number(maxAddons),
        });
        if (!saveRes.ok) return setError(saveRes.error);
        const addonsRes = await setCategoryAddons(category.id, [...picked]);
        if (!addonsRes.ok) return setError(addonsRes.error);
        onChanged();
      } catch {
        setError("Couldn't save. Please try again.");
      }
    });
  }

  function toggleAddon(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  const activeAddons = addons.filter((a) => !a.isArchived);

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-3 sm:p-4",
        category.isArchived && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-xs font-bold tabular-nums text-muted-foreground">
          {index + 1}
        </span>
        <div className="flex flex-col">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onUp}
            disabled={isFirst}
            aria-label="Move up"
          >
            <ChevronUp className="size-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDown}
            disabled={isLast}
            aria-label="Move down"
          >
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 truncate text-sm font-semibold">
            {category.name}
            {category.isArchived && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Archived
              </span>
            )}
          </span>
          <span className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {category.addonIds.length} add-on
            {category.addonIds.length === 1 ? "" : "s"} · max {category.maxAddons}
          </span>
        </div>
        <Button
          variant={open ? "secondary" : "ghost"}
          size="sm"
          className="rounded-full"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Edit"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`name-${category.id}`}>Name</Label>
            <Input
              id={`name-${category.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`max-addons-${category.id}`}>Max add-ons</Label>
            <Input
              id={`max-addons-${category.id}`}
              inputMode="numeric"
              value={maxAddons}
              onChange={(e) => setMaxAddons(e.target.value)}
              className="w-24 font-mono tabular-nums"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Default add-ons</Label>
            {activeAddons.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No add-ons available.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {activeAddons.map((a) => {
                  const checked = picked.has(a.id);
                  return (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAddon(a.id)}
                        className="size-4 accent-foreground rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                      <span
                        className={cn("flex-1", !checked && "text-muted-foreground")}
                      >
                        {a.name}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        RM {(a.price / 100).toFixed(2)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const res = await setCategoryArchived(
                      category.id,
                      !category.isArchived,
                    );
                    if (!res.ok) return setError(res.error);
                    onChanged();
                  } catch {
                    setError("Couldn't update. Please try again.");
                  }
                });
              }}
            >
              {category.isArchived ? "Restore" : "Archive"}
            </Button>
            <Button onClick={save} className="flex-1 rounded-full">
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
