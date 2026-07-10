"use client";

import { useRef, useState } from "react";
import { Trash2, Plus, Check, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { filterDigits } from "@/lib/input";
import { formatPrice } from "@/lib/format";
import { deriveGoodsCost, renderStep, mergeRecipe, type RecipeEntry } from "@/lib/menu/recipe";
import type { AdminCostItem } from "@/lib/menu/types";

// Per-inherited-ingredient control the parent owns (stored as exclude/override
// entries on the product recipe). overrideGrams null = inherit the base grams.
export type InheritedControl = { excluded: boolean; overrideGrams: number | null };

// Shared recipe builder used by both the product form and the category editor.
// It edits an ordered list of ingredient/free entries (`value`); the ingredient
// picker, prep-step list (drag/reorder + grams), and live goods cost all work
// off that list. When `inherited` is passed (product form), the category base is
// shown read-only above the picker with per-ingredient skip + grams-override
// controls, and the live cost reflects the merged result.
export function RecipeBuilder({
  costItems,
  value,
  onChange,
  inherited,
  inheritedControls,
  onInheritedControlChange,
}: {
  costItems: AdminCostItem[];
  value: RecipeEntry[];
  onChange: (next: RecipeEntry[]) => void;
  inherited?: RecipeEntry[];
  inheritedControls?: Map<string, InheritedControl>;
  onInheritedControlChange?: (costItemId: string, next: InheritedControl) => void;
}) {
  // Keep the moved handlers near-identical to their product-form origin.
  const setRecipe = (
    updater: RecipeEntry[] | ((prev: RecipeEntry[]) => RecipeEntry[]),
  ) => onChange(typeof updater === "function" ? updater(value) : updater);

  const activeCostItems = costItems.filter((c) => !c.isArchived);
  const alwaysItems = activeCostItems.filter((c) => c.alwaysIncluded);
  const optionalItems = activeCostItems.filter((c) => !c.alwaysIncluded);
  const templateById = new Map(costItems.map((c) => [c.id, c.prepTemplate]));

  // Which optional cost items are currently in the list (as ingredient steps).
  const tickedIds = new Set(
    value.flatMap((e) => (e.kind === "ingredient" ? [e.costItemId] : [])),
  );

  function inheritedControl(id: string): InheritedControl {
    return inheritedControls?.get(id) ?? { excluded: false, overrideGrams: null };
  }
  function setInheritedControl(id: string, next: InheritedControl) {
    onInheritedControlChange?.(id, next);
  }

  function toggleIngredient(costItemId: string) {
    setRecipe((prev) => {
      const exists = prev.some(
        (e) => e.kind === "ingredient" && e.costItemId === costItemId,
      );
      if (exists)
        return prev.filter(
          (e) => !(e.kind === "ingredient" && e.costItemId === costItemId),
        );
      // New ingredient step appended at the bottom; drag to reposition.
      return [
        ...prev,
        { kind: "ingredient", costItemId, grams: null, text: null, custom: false },
      ];
    });
  }

  function addFreeStep() {
    setRecipe((prev) => [...prev, { kind: "free", text: "" }]);
  }

  function removeAt(index: number) {
    setRecipe((prev) => prev.filter((_, i) => i !== index));
  }

  // Adjacent swap for the up/down buttons.
  function move(index: number, dir: -1 | 1) {
    setRecipe((prev) => {
      const to = index + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  // Pointer-drag reordering. The grabbed row lifts out of flow (position:fixed)
  // and follows the pointer; its origin collapses and a card-sized placeholder
  // opens at the target slot. `drop` is the target index in the list with the
  // dragged row removed (0..length-1). We commit once, on release.
  const [drag, setDrag] = useState<{
    from: number;
    drop: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  // Pointer offset within the grabbed row, so it stays under the cursor.
  const grabDy = useRef(0);
  // Latest {from,drop} in a ref so release commits without a stale closure and
  // without nesting setRecipe inside a state updater (StrictMode would
  // otherwise apply the move twice).
  const dragInfo = useRef<{ from: number; drop: number } | null>(null);

  function startDrag(index: number, e: React.PointerEvent) {
    e.preventDefault();
    const list = (e.currentTarget as HTMLElement).closest("ol");
    const li = (e.currentTarget as HTMLElement).closest("li");
    if (!list || !li) return;
    const rect = li.getBoundingClientRect();
    grabDy.current = e.clientY - rect.top;
    dragInfo.current = { from: index, drop: index };
    setDrag({
      from: index,
      drop: index,
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    });

    const onMove = (ev: PointerEvent) => {
      // Measure the live sibling rows (everything except the lifted row), so the
      // target tracks the pointer even as rows reflow around the placeholder.
      const siblings = Array.from(
        list.querySelectorAll<HTMLElement>("li[data-step]"),
      ).filter((r) => r.dataset.step !== String(index));
      let drop = 0;
      for (const r of siblings) {
        const b = r.getBoundingClientRect();
        if (ev.clientY > b.top + b.height / 2) drop += 1;
      }
      dragInfo.current = { from: index, drop };
      setDrag((d) => (d ? { ...d, drop, y: ev.clientY - grabDy.current } : d));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const info = dragInfo.current;
      dragInfo.current = null;
      setDrag(null);
      if (!info || info.drop === info.from) return;
      setRecipe((prev) => {
        const next = [...prev];
        const [moved] = next.splice(info.from, 1);
        next.splice(Math.max(0, Math.min(info.drop, next.length)), 0, moved);
        return next;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Editing grams re-renders an untouched ingredient step from its template
  // (text stays null); a custom step keeps its frozen text.
  function setGramsAt(index: number, gramsStr: string) {
    const n = Number(gramsStr);
    const grams = gramsStr.trim() === "" || !Number.isFinite(n) ? null : n;
    setRecipe((prev) =>
      prev.map((e, i) =>
        i === index && e.kind === "ingredient" ? { ...e, grams } : e,
      ),
    );
  }

  // Editing an ingredient step's text freezes it (custom=true). Free steps just
  // update text.
  function setTextAt(index: number, text: string) {
    setRecipe((prev) =>
      prev.map((e, i) => {
        if (i !== index) return e;
        if (e.kind === "free") return { ...e, text };
        if (e.kind === "ingredient") return { ...e, text, custom: true };
        return e;
      }),
    );
  }

  // Revert a frozen ingredient step back to its template.
  function resetToTemplate(index: number) {
    setRecipe((prev) =>
      prev.map((e, i) =>
        i === index && e.kind === "ingredient"
          ? { ...e, text: null, custom: false }
          : e,
      ),
    );
  }

  // Live goods cost (sen): merged (inherited base + own) ingredients + every
  // always-included item.
  const goodsCost = deriveGoodsCost(
    mergeRecipe(inherited ?? null, value),
    activeCostItems.map((c) => ({
      id: c.id,
      price: c.price,
      alwaysIncluded: c.alwaysIncluded,
      isArchived: c.isArchived,
    })),
  );

  const inheritedIngredients = (inherited ?? []).filter(
    (e): e is Extract<RecipeEntry, { kind: "ingredient" }> => e.kind === "ingredient",
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Always-included items: shown locked, counted automatically. */}
      {alwaysItems.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Always included
          </span>
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-muted/30">
            {alwaysItems.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 px-3 py-2.5 text-sm"
              >
                <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-foreground text-background">
                  <Check className="size-3" aria-hidden />
                </span>
                <span className="flex-1">{c.name}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {formatPrice(c.price)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inherited category base: read-only, with skip + grams-override. */}
      {inheritedIngredients.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            From category
          </span>
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-muted/30">
            {inheritedIngredients.map((e) => (
              <InheritedRow
                key={e.costItemId}
                entry={e}
                costItem={activeCostItems.find((c) => c.id === e.costItemId) ?? null}
                control={inheritedControl(e.costItemId)}
                onChange={(next) => setInheritedControl(e.costItemId, next)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Ingredient picker — tap to add a step, tap again to remove. */}
      <div className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Ingredients
        </span>
        <div className="flex flex-wrap gap-2">
          {optionalItems.map((c) => {
            const on = tickedIds.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleIngredient(c.id)}
                aria-pressed={on}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-border hover:bg-muted",
                )}
              >
                {on && <Check className="size-3" aria-hidden />}
                {c.name}
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    on ? "text-background/70" : "text-muted-foreground",
                  )}
                >
                  {formatPrice(c.price)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ordered step list — ingredient + free steps, reorderable. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Prep steps
          </span>
          <button
            type="button"
            onClick={addFreeStep}
            className="flex items-center gap-1 rounded-sm text-xs font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Plus className="size-4" /> Add step
          </button>
        </div>
        {value.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Tick an ingredient above or add a step. Drag to reorder.
          </p>
        ) : (
          <ol className="relative flex flex-col gap-2">
            {value.map((entry, i) => (
              <div key={i} className="contents">
                {/* Placeholder opens a card-sized space at the target.
                    `drop` counts in-flow rows (the dragged row is
                    lifted out), so place it before the row whose
                    in-flow position equals drop — skipping the dragged
                    row itself to avoid a double render. */}
                {drag &&
                  i !== drag.from &&
                  (i <= drag.from ? i : i - 1) === drag.drop && (
                    <DropPlaceholder h={drag.h} />
                  )}
                <RecipeStepRow
                  index={i}
                  total={value.length}
                  entry={entry}
                  templateById={templateById}
                  costName={
                    entry.kind === "ingredient"
                      ? activeCostItems.find((c) => c.id === entry.costItemId)?.name ??
                        "Ingredient"
                      : ""
                  }
                  lift={drag?.from === i ? { x: drag.x, y: drag.y, w: drag.w } : null}
                  onGrams={(g) => setGramsAt(i, g)}
                  onText={(t) => setTextAt(i, t)}
                  onReset={() => resetToTemplate(i)}
                  onRemove={() => removeAt(i)}
                  onMove={(dir) => move(i, dir)}
                  onDragStart={(e) => startDrag(i, e)}
                />
              </div>
            ))}
            {/* Placeholder at the end of the list (last in-flow slot). */}
            {drag && drag.drop === value.length - 1 && (
              <DropPlaceholder h={drag.h} />
            )}
          </ol>
        )}
      </div>

      <div className="flex items-center justify-between rounded-xl bg-foreground px-4 py-3 text-background">
        <span className="text-sm font-semibold">Goods cost per drink</span>
        <span className="font-mono text-lg font-bold tabular-nums">
          {formatPrice(goodsCost)}
        </span>
      </div>
    </div>
  );
}

// One inherited (category-base) ingredient: read-only name with a grams-override
// input (placeholder shows the base grams) and a Skip checkbox. Editing these
// writes exclude/override directives on the product recipe (parent-owned).
function InheritedRow({
  entry,
  costItem,
  control,
  onChange,
}: {
  entry: Extract<RecipeEntry, { kind: "ingredient" }>;
  costItem: { name: string; price: number } | null;
  control: InheritedControl;
  onChange: (next: InheritedControl) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <span
        className={cn(
          "flex-1",
          control.excluded && "text-muted-foreground line-through",
        )}
      >
        {costItem?.name ?? "Ingredient"}
      </span>
      <div className="relative w-20 shrink-0">
        <Input
          inputMode="numeric"
          value={control.overrideGrams == null ? "" : String(control.overrideGrams)}
          onChange={(e) => {
            const digits = filterDigits(e.target.value);
            onChange({ ...control, overrideGrams: digits === "" ? null : Number(digits) });
          }}
          placeholder={entry.grams == null ? "—" : String(entry.grams)}
          aria-label={`${costItem?.name ?? "Ingredient"} grams override`}
          disabled={control.excluded}
          className="w-full pr-6 font-mono tabular-nums"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          g
        </span>
      </div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={control.excluded}
          onChange={(e) => onChange({ ...control, excluded: e.target.checked })}
          className="size-4 accent-foreground"
        />
        Skip
      </label>
    </div>
  );
}

// A placeholder that opens a real, card-sized space at the drop target while
// dragging, so the list visibly parts to receive the row.
function DropPlaceholder({ h }: { h: number }) {
  return (
    <li
      aria-hidden
      style={{ height: h }}
      className="pointer-events-none rounded-xl border-2 border-dashed border-primary/60 bg-primary/5"
    />
  );
}

// One row in the ordered recipe list: drag handle + up/down for reorder, an
// editable body (ingredient steps render from their template with grams inline;
// free steps are plain text), and a remove control. While its own row is being
// dragged it lifts out of flow (position:fixed) and follows the pointer, so its
// origin collapses.
function RecipeStepRow({
  index,
  total,
  entry,
  templateById,
  costName,
  lift,
  onGrams,
  onText,
  onReset,
  onRemove,
  onMove,
  onDragStart,
}: {
  index: number;
  total: number;
  entry: RecipeEntry;
  templateById: Map<string, string | null>;
  costName: string;
  lift: { x: number; y: number; w: number } | null;
  onGrams: (grams: string) => void;
  onText: (text: string) => void;
  onReset: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const isIngredient = entry.kind === "ingredient";
  const custom = isIngredient && entry.custom;
  const hasTemplate =
    isIngredient && !!templateById.get(entry.costItemId);
  // Untouched ingredient step shows its rendered template as the input value;
  // editing it freezes to custom. Custom/free show their own text.
  const shownText =
    isIngredient && !custom
      ? renderStep(entry, templateById)
      : "text" in entry
        ? entry.text ?? ""
        : "";

  return (
    <li
      data-step={index}
      style={
        lift
          ? { position: "fixed", left: lift.x, top: lift.y, width: lift.w, margin: 0 }
          : undefined
      }
      className={cn(
        "flex items-start gap-2 rounded-xl border bg-card px-2 py-2",
        lift
          ? "z-20 border-primary shadow-2xl ring-2 ring-primary/30 [&_input]:pointer-events-none"
          : "border-border",
      )}
    >
      <div className="flex flex-col items-center gap-0.5 pt-1">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Move step up"
          className="rounded-sm p-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground disabled:opacity-30 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronUp className="size-4" />
        </button>
        <span
          onPointerDown={onDragStart}
          aria-hidden
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="Move step down"
          className="rounded-sm p-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground disabled:opacity-30 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      <span className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground tabular-nums">
        {index + 1}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Input
            value={shownText}
            onChange={(e) => onText(e.target.value)}
            placeholder={isIngredient ? "Step text" : `Step ${index + 1}`}
            className="flex-1"
          />
          {isIngredient && (
            <div className="relative w-20 shrink-0">
              <Input
                inputMode="numeric"
                value={entry.grams == null ? "" : String(entry.grams)}
                onChange={(e) => onGrams(filterDigits(e.target.value))}
                placeholder="0"
                aria-label={`${costName} grams`}
                className="w-full pr-7 font-mono tabular-nums"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                g
              </span>
            </div>
          )}
        </div>
        {isIngredient && (
          <div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
              {costName}
            </span>
            {custom && hasTemplate && (
              <button
                type="button"
                onClick={onReset}
                className="rounded-sm font-semibold outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Reset to template
              </button>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove step"
        className="mt-1.5 rounded-sm p-1 text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
