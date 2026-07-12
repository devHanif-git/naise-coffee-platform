"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, RotateCcw, Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { AdminBackLink } from "@/components/admin/admin-back-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { useUnsavedChanges, useGuardedNavigation } from "@/components/admin/unsaved-changes";
import type { AdminCostItem } from "@/lib/menu/types";
import { saveCostItems } from "@/app/(admin)/admin/costs/actions";

const toSen = (rm: string) => Math.round(parseFloat(rm || "0") * 100);
const toRm = (sen: number) => (sen / 100).toFixed(2);

// Editable row state. `key` is a stable client-side id for React reconciliation
// (saved rows have a db id; new rows don't until saved). price is a string so
// the input can hold partial values while typing.
type Row = {
  key: string;
  id?: string;
  name: string;
  price: string;
  alwaysIncluded: boolean;
  isArchived: boolean;
  prepTemplate: string;
};

function toRow(item: AdminCostItem): Row {
  return {
    key: item.id,
    id: item.id,
    name: item.name,
    price: toRm(item.price),
    alwaysIncluded: item.alwaysIncluded,
    isArchived: item.isArchived,
    prepTemplate: item.prepTemplate ?? "",
  };
}

// Shared column template so the header and every row line up. Mobile stacks
// instead, so each row carries its own labels.
const COLS =
  "sm:grid sm:grid-cols-[1fr_7rem_8.5rem_2.25rem] sm:items-center sm:gap-3";

export function CostManager({ initial }: { initial: AdminCostItem[] }) {
  const router = useRouter();
  const { guardedPush } = useGuardedNavigation();
  const [rows, setRows] = useState<Row[]>(initial.map(toRow));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextKey = useRef(0);

  // Dirty detection: compare rows to the last-saved baseline. router.refresh()
  // keeps client state, so the baseline advances on a successful save (below)
  // rather than resetting via reload.
  const current = JSON.stringify(rows.map(({ key, ...rest }) => (void key, rest)));
  const [saved, setSaved] = useState(current);
  useUnsavedChanges(current !== saved);
  // The row key to focus + flash after a render, set by addRow.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // After a row is added (or an existing empty one re-targeted), bring it into
  // view, drop the cursor in its name field, and flash it so the press always
  // produces a visible result.
  useEffect(() => {
    if (!focusKey || !listRef.current) return;
    const rowEl = listRef.current.querySelector<HTMLElement>(
      `[data-row="${focusKey}"]`,
    );
    if (!rowEl) return;
    rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
    // The name field is the first input in the row.
    rowEl.querySelector<HTMLInputElement>("input")?.focus();
    rowEl.classList.remove("naise-flash");
    // Force reflow so re-adding the class restarts the animation on repeat taps.
    void rowEl.offsetWidth;
    rowEl.classList.add("naise-flash");
    setFocusKey(null);
  }, [focusKey, rows]);

  function update(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    // Don't stack blanks: if an empty row is already waiting, just jump to it
    // instead of creating another. Otherwise prepend a fresh one so it's
    // visible at the top of the list immediately.
    const existingBlank = rows.find(
      (r) => !r.isArchived && !r.name.trim() && !r.price.trim(),
    );
    if (existingBlank) {
      setFocusKey(existingBlank.key);
      return;
    }
    const key = `new-${nextKey.current++}`;
    setRows((prev) => [
      { key, name: "", price: "", alwaysIncluded: false, isArchived: false, prepTemplate: "" },
      ...prev,
    ]);
    setFocusKey(key);
  }

  function removeRow(index: number) {
    // Unsaved rows drop entirely; saved rows archive (soft-delete) so order
    // history that referenced them stays intact.
    setRows((prev) =>
      prev[index].id
        ? prev.map((r, i) => (i === index ? { ...r, isArchived: true } : r))
        : prev.filter((_, i) => i !== index),
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveCostItems(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            price: toSen(r.price),
            alwaysIncluded: r.alwaysIncluded,
            isArchived: r.isArchived,
            prepTemplate: r.prepTemplate.trim() || null,
          })),
        );
        if (res.ok) {
          setSaved(current);
          router.refresh();
        } else setError(res.error);
      } catch {
        setError("Save failed. Please try again.");
      }
    });
  }

  const active = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.isArchived);
  const archived = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.isArchived);

  // What every drink's cost starts at: the sum of items marked "in every cup".
  const baseItems = active.filter(({ row }) => row.alwaysIncluded);
  const baseTotal = baseItems.reduce((sum, { row }) => sum + toSen(row.price), 0);

  return (
    <div className="flex flex-col gap-6">
      <AdminBackLink href="/admin/menu" label="Back to Menu" />
      <AdminPageHeader
        title="Cost Goods"
        description="What each raw ingredient costs you. These feed every drink's goods cost and your profit — customers never see them."
      >
        <Button size="sm" className="rounded-full" onClick={addRow}>
          <Plus className="size-4" /> Add ingredient
        </Button>
      </AdminPageHeader>

      {/* Base-cost summary: the figure that silently rides on every cup. Ties
          the toggle below to a real number. Stacks on mobile, row on desktop. */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background">
            <Coffee className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Every cup starts at
            </span>
            <span className="font-mono text-3xl font-bold tabular-nums tracking-tight">
              {formatPrice(baseTotal)}
            </span>
          </div>
        </div>
        <p className="border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground sm:ml-auto sm:max-w-[15rem] sm:border-t-0 sm:pt-0 sm:text-right">
          {baseItems.length === 0
            ? "Turn on “in every cup” for packaging or other shared items to set this."
            : `${baseItems.length} item${baseItems.length === 1 ? "" : "s"} added to every drink before its recipe.`}
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        {/* Column headers — always visible on desktop. On mobile each row
            repeats the labels inline, so the toggle is never unlabelled. */}
        <div
          className={cn(
            "hidden border-b border-border bg-muted/40 px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
            COLS,
          )}
        >
          <span>Ingredient</span>
          <span>Cost</span>
          <span className="text-center">In every cup</span>
          <span className="sr-only">Remove</span>
        </div>

        <div ref={listRef} className="flex flex-col">
          {active.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No ingredients yet. Add your first one below.
            </p>
          )}
          {active.map(({ row, index }) => (
            <CostRow
              key={row.key}
              row={row}
              cols={COLS}
              onChange={(patch) => update(index, patch)}
              onRemove={() => removeRow(index)}
            />
          ))}
        </div>
      </section>

      {archived.length > 0 && (
        <section className="flex flex-col gap-3">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Archived · {archived.length}
          </span>
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {archived.map(({ row, index }) => (
              <div
                key={row.key}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className="flex-1 truncate text-muted-foreground">{row.name}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  RM {row.price}
                </span>
                <button
                  type="button"
                  onClick={() => update(index, { isArchived: false })}
                  className="flex items-center gap-1 rounded-sm text-xs font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <RotateCcw className="size-3.5" /> Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* One sticky Save for the whole list, mirroring the product form. */}
      <div className="sticky bottom-4 z-10 flex gap-2 rounded-2xl border border-border bg-background/85 p-3 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 rounded-full"
          onClick={() => guardedPush("/admin/menu")}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="h-11 flex-1 rounded-full"
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function CostRow({
  row,
  cols,
  onChange,
  onRemove,
}: {
  row: Row;
  cols: string;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      data-row={row.key}
      className="border-b border-border px-4 py-4 last:border-b-0 transition-colors sm:py-3"
    >
      <div className={cn(row.alwaysIncluded && "bg-muted/30", cols)}>
        {/* Ingredient name */}
        <div className="flex items-center gap-2">
          <Input
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Oat milk"
            className="w-full"
          />
          {row.alwaysIncluded && (
            <span className="hidden shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-background sm:inline">
              Every cup
            </span>
          )}
        </div>

        {/* Cost — settings row on mobile (label left, field right). */}
        <div className="mt-3 flex items-center justify-between gap-3 sm:mt-0 sm:block">
          <span className="text-sm font-medium text-muted-foreground sm:hidden">
            Cost
          </span>
          <div className="relative w-32 sm:w-full">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              RM
            </span>
            <Input
              inputMode="decimal"
              value={row.price}
              onChange={(e) => onChange({ price: e.target.value })}
              placeholder="0.00"
              aria-label={`${row.name || "Ingredient"} cost in ringgit`}
              className="w-full pl-9 text-right font-mono tabular-nums sm:text-left"
            />
          </div>
        </div>

        {/* In-every-cup toggle — settings row on mobile, carries its own label. */}
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 sm:mt-0 sm:justify-center">
          <span className="text-sm font-medium text-muted-foreground sm:hidden">
            In every cup
          </span>
          <Switch
            checked={row.alwaysIncluded}
            onCheckedChange={(v) => onChange({ alwaysIncluded: v })}
            aria-label="Add to every cup"
          />
        </label>

        {/* Remove — full-width affordance on mobile, icon on desktop. */}
        <div className="mt-3 border-t border-border pt-3 sm:mt-0 sm:flex sm:justify-center sm:border-t-0 sm:pt-0">
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Archive ${row.name || "ingredient"}`}
            className="flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Trash2 className="size-4" />
            <span className="sm:hidden">Remove ingredient</span>
          </button>
        </div>
      </div>

      {/* Prep step text — the step this ingredient generates in a recipe. {g}
          is replaced with the grams entered on that step. */}
      <div className="mt-3 flex flex-col gap-1">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Prep step text{" "}
          <span className="font-normal normal-case">— use {"{g}"} for grams</span>
        </span>
        <Input
          value={row.prepTemplate}
          onChange={(e) => onChange({ prepTemplate: e.target.value })}
          placeholder="e.g. Steam {g}g milk"
          aria-label={`${row.name || "Ingredient"} prep step text`}
          className="w-full"
        />
      </div>
    </div>
  );
}
