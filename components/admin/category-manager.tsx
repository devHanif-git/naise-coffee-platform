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

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-heading text-base font-semibold">New category</h2>
        <div className="mt-3 flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-category">Name</Label>
            <Input
              id="new-category"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Pastries"
            />
          </div>
          <Button onClick={add}>Add</Button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {cats.length === 0 ? (
        <p className="text-sm text-muted-foreground">No categories yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cats.map((c, i) => (
            <CategoryRow
              key={c.id}
              category={c}
              addons={addons}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onChanged={refreshFromServer}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  addons,
  onUp,
  onDown,
  onChanged,
}: {
  category: AdminCategory;
  addons: AdminAddon[];
  onUp: () => void;
  onDown: () => void;
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
        "rounded-xl border border-border bg-card p-4",
        category.isArchived && "opacity-50",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onUp}
            aria-label="Move up"
          >
            <ChevronUp className="size-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDown}
            aria-label="Move down"
          >
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </div>
        <span className="flex-1 text-sm font-semibold">{category.name}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Edit"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-3">
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
              activeAddons.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-3 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(a.id)}
                    onChange={() => toggleAddon(a.id)}
                    className="size-4 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                  <span className="flex-1">{a.name}</span>
                </label>
              ))
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="outline"
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
            <Button onClick={save} className="flex-1">
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
