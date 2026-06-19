"use client";

import { useState, useTransition } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AdminBackLink } from "@/components/admin/admin-back-link";
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
    const next = [...cats];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setCats(next);
    startTransition(async () => {
      await reorderCategories(next.map((c) => c.id));
    });
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <AdminBackLink href="/admin/menu" label="Back to Menu" />
      <h1 className="font-heading text-lg font-bold tracking-tight">Categories</h1>

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>New category</Label>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Pastries"
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
  const [, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      await saveCategory({ id: category.id, name, maxAddons: Number(maxAddons) });
      await setCategoryAddons(category.id, [...picked]);
      onChanged();
    });
  }

  function toggleAddon(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border p-3",
        category.isArchived && "opacity-50",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button onClick={onUp} aria-label="Move up">
            <ChevronUp className="size-4 text-muted-foreground" />
          </button>
          <button onClick={onDown} aria-label="Move down">
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </div>
        <span className="flex-1 text-sm font-semibold">{category.name}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-semibold text-muted-foreground underline"
        >
          {open ? "Close" : "Edit"}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Max add-ons</Label>
            <Input
              inputMode="numeric"
              value={maxAddons}
              onChange={(e) => setMaxAddons(e.target.value)}
              className="w-24"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Default add-ons</Label>
            {addons
              .filter((a) => !a.isArchived)
              .map((a) => (
                <label key={a.id} className="flex items-center gap-3 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.has(a.id)}
                    onChange={() => toggleAddon(a.id)}
                    className="size-4"
                  />
                  <span className="flex-1">{a.name}</span>
                </label>
              ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() =>
                startTransition(async () => {
                  await setCategoryArchived(category.id, !category.isArchived);
                  onChanged();
                })
              }
              className="rounded-2xl border border-border px-4 py-2 text-sm font-semibold"
            >
              {category.isArchived ? "Restore" : "Archive"}
            </button>
            <button
              onClick={save}
              className="flex-1 rounded-2xl bg-black py-2 text-sm font-semibold text-white"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
