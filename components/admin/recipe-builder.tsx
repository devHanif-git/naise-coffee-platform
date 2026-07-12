"use client";

import { useRef, useState } from "react";
import { Trash2, Plus, Check, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { filterDigits } from "@/lib/input";
import { formatPrice } from "@/lib/format";
import { deriveGoodsCost, renderStep, mergeRecipe, type RecipeEntry } from "@/lib/menu/recipe";
import type { AdminCostItem } from "@/lib/menu/types";

// Shared recipe builder used by both the product form and the category editor.
//
// `value` is the full working recipe: ordered rows (inherited markers + own
// ingredient/free steps) followed by directive entries (exclude/override). The
// builder renders every ordered row in ONE reorderable list — inherited steps
// included — so category steps can be dragged, interleaved, skipped, and
// grams-overridden right alongside the drink's own steps.
//
// `inherited` (the category base) is used only to resolve each inherited
// marker's name, template, price, and base grams. The category editor passes no
// `inherited`, so its list has no markers/directives and behaves as a plain
// ordered recipe.
export function RecipeBuilder({
  costItems,
  value,
  onChange,
  inherited,
}: {
  costItems: AdminCostItem[];
  value: RecipeEntry[];
  onChange: (next: RecipeEntry[]) => void;
  inherited?: RecipeEntry[];
}) {
  const activeCostItems = costItems.filter((c) => !c.isArchived);
  // Only packaging-type always items (no prep template) show in the locked list.
  // Templated always items (e.g. ice) arrive as inherited base rows instead.
  const alwaysItems = activeCostItems.filter(
    (c) => c.alwaysIncluded && !c.prepTemplate,
  );
  const templateById = new Map(costItems.map((c) => [c.id, c.prepTemplate]));
  // Always-included ids — inherited rows for these came from Cost Goods ("every
  // cup"), not a category, so they get a different source badge.
  const alwaysIncludedIds = new Set(
    activeCostItems.filter((c) => c.alwaysIncluded).map((c) => c.id),
  );

  const base = (inherited ?? []).filter(
    (e): e is Extract<RecipeEntry, { kind: "ingredient" }> => e.kind === "ingredient",
  );
  const baseById = new Map(base.map((e) => [e.costItemId, e]));
  const inheritedIds = new Set(baseById.keys());

  // Split the working list into ordered rows and directive metadata.
  const ordered = value.filter(
    (e) => e.kind === "inherited" || e.kind === "ingredient" || e.kind === "free",
  );
  const directives = value.filter(
    (e) => e.kind === "exclude" || e.kind === "override",
  );
  const excluded = new Set(
    directives.flatMap((e) => (e.kind === "exclude" ? [e.costItemId] : [])),
  );
  const overrides = new Map(
    directives.flatMap((e) => (e.kind === "override" ? [[e.costItemId, e.grams] as const] : [])),
  );

  // Optional items not already inherited — the picker only adds NEW ingredients.
  const optionalItems = activeCostItems.filter(
    (c) => !c.alwaysIncluded && !inheritedIds.has(c.id),
  );
  const tickedIds = new Set(
    ordered.flatMap((e) => (e.kind === "ingredient" ? [e.costItemId] : [])),
  );

  // Commit a new ordered list (directives unchanged unless passed).
  function commit(nextOrdered: RecipeEntry[], nextDirectives: RecipeEntry[] = directives) {
    onChange([...nextOrdered, ...nextDirectives]);
  }

  function toggleIngredient(costItemId: string) {
    const exists = ordered.some(
      (e) => e.kind === "ingredient" && e.costItemId === costItemId,
    );
    if (exists) {
      commit(
        ordered.filter(
          (e) => !(e.kind === "ingredient" && e.costItemId === costItemId),
        ),
      );
    } else {
      commit([
        ...ordered,
        { kind: "ingredient", costItemId, grams: null, text: null, custom: false },
      ]);
    }
  }

  function addFreeStep() {
    commit([...ordered, { kind: "free", text: "" }]);
  }

  function removeAt(index: number) {
    commit(ordered.filter((_, i) => i !== index));
  }

  // Adjacent swap for the up/down buttons.
  function move(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[to]] = [next[to], next[index]];
    commit(next);
  }

  // Editing grams on an OWN ingredient step.
  function setGramsAt(index: number, gramsStr: string) {
    const n = Number(gramsStr);
    const grams = gramsStr.trim() === "" || !Number.isFinite(n) ? null : n;
    commit(
      ordered.map((e, i) =>
        i === index && e.kind === "ingredient" ? { ...e, grams } : e,
      ),
    );
  }

  // Editing an own ingredient step's text freezes it (custom=true). Free steps
  // just update text.
  function setTextAt(index: number, text: string) {
    commit(
      ordered.map((e, i) => {
        if (i !== index) return e;
        if (e.kind === "free") return { ...e, text };
        if (e.kind === "ingredient") return { ...e, text, custom: true };
        return e;
      }),
    );
  }

  // Revert a frozen own ingredient step back to its template.
  function resetToTemplate(index: number) {
    commit(
      ordered.map((e, i) =>
        i === index && e.kind === "ingredient"
          ? { ...e, text: null, custom: false }
          : e,
      ),
    );
  }

  // Skip / un-skip an inherited base ingredient (writes/removes an exclude
  // directive). The marker row stays in place so it can be un-skipped.
  function setSkip(costItemId: string, skip: boolean) {
    const rest = directives.filter(
      (e) => !(e.kind === "exclude" && e.costItemId === costItemId),
    );
    commit(ordered, skip ? [...rest, { kind: "exclude", costItemId }] : rest);
  }

  // Set / clear a grams override on an inherited base ingredient.
  function setOverride(costItemId: string, gramsStr: string) {
    const rest = directives.filter(
      (e) => !(e.kind === "override" && e.costItemId === costItemId),
    );
    const digits = gramsStr.trim();
    commit(
      ordered,
      digits === "" ? rest : [...rest, { kind: "override", costItemId, grams: Number(digits) }],
    );
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
  const grabDy = useRef(0);
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
      const next = [...ordered];
      const [moved] = next.splice(info.from, 1);
      next.splice(Math.max(0, Math.min(info.drop, next.length)), 0, moved);
      commit(next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Live goods cost (sen): merged (inherited base + working list) ingredients +
  // packaging-type always-included items. mergeRecipe handles markers/directives.
  const goodsCost = deriveGoodsCost(
    mergeRecipe(inherited ?? null, value),
    activeCostItems.map((c) => ({
      id: c.id,
      price: c.price,
      alwaysIncluded: c.alwaysIncluded,
      isArchived: c.isArchived,
      prepTemplate: c.prepTemplate,
    })),
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

      {/* Ordered step list — inherited + own steps, all reorderable. */}
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
        {ordered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Tick an ingredient above or add a step. Drag to reorder.
          </p>
        ) : (
          <ol className="relative flex flex-col gap-2">
            {ordered.map((entry, i) => {
              const isInherited = entry.kind === "inherited";
              const inheritedBase = isInherited ? baseById.get(entry.costItemId) : undefined;
              const overrideGrams = isInherited ? overrides.get(entry.costItemId) ?? null : null;
              const isExcluded = isInherited && excluded.has(entry.costItemId);
              const costName = isInherited
                ? inheritedBase
                  ? activeCostItems.find((c) => c.id === entry.costItemId)?.name ?? "Ingredient"
                  : "Ingredient"
                : entry.kind === "ingredient"
                  ? activeCostItems.find((c) => c.id === entry.costItemId)?.name ?? "Ingredient"
                  : "";
              // Inherited step text renders from the base entry (with override
              // grams applied), read-only.
              const inheritedText = inheritedBase
                ? renderStep(
                    overrideGrams == null ? inheritedBase : { ...inheritedBase, grams: overrideGrams },
                    templateById,
                  )
                : "";
              // Where an inherited row comes from: an always-included cost item
              // ("Every cup") vs a category base ingredient ("From category").
              const sourceLabel = isInherited
                ? alwaysIncludedIds.has(entry.costItemId)
                  ? "Every cup"
                  : "From category"
                : "";
              return (
                <div key={i} className="contents">
                  {drag &&
                    i !== drag.from &&
                    (i <= drag.from ? i : i - 1) === drag.drop && (
                      <DropPlaceholder h={drag.h} />
                    )}
                  <RecipeStepRow
                    index={i}
                    total={ordered.length}
                    entry={entry}
                    templateById={templateById}
                    costName={costName}
                    sourceLabel={sourceLabel}
                    inheritedText={inheritedText}
                    basePlaceholder={inheritedBase?.grams ?? null}
                    overrideGrams={overrideGrams}
                    excluded={isExcluded}
                    lift={drag?.from === i ? { x: drag.x, y: drag.y, w: drag.w } : null}
                    onGrams={(g) => setGramsAt(i, g)}
                    onText={(t) => setTextAt(i, t)}
                    onReset={() => resetToTemplate(i)}
                    onRemove={() => removeAt(i)}
                    onMove={(dir) => move(i, dir)}
                    onDragStart={(e) => startDrag(i, e)}
                    onSkip={(v) => isInherited && setSkip(entry.costItemId, v)}
                    onOverrideGrams={(g) => isInherited && setOverride(entry.costItemId, g)}
                  />
                </div>
              );
            })}
            {drag && drag.drop === ordered.length - 1 && (
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

// One row in the ordered recipe list. Three body variants share the same drag
// handle + position chrome:
//   - inherited marker: read-only step text + grams-override input + Skip toggle
//     (badged with its source — "Every cup" or "From category"); no remove.
//   - own ingredient: editable text (freezes to custom), grams, reset, remove.
//   - free step: editable text, remove.
function RecipeStepRow({
  index,
  total,
  entry,
  templateById,
  costName,
  sourceLabel,
  inheritedText,
  basePlaceholder,
  overrideGrams,
  excluded,
  lift,
  onGrams,
  onText,
  onReset,
  onRemove,
  onMove,
  onDragStart,
  onSkip,
  onOverrideGrams,
}: {
  index: number;
  total: number;
  entry: RecipeEntry;
  templateById: Map<string, string | null>;
  costName: string;
  sourceLabel: string;
  inheritedText: string;
  basePlaceholder: number | null;
  overrideGrams: number | null;
  excluded: boolean;
  lift: { x: number; y: number; w: number } | null;
  onGrams: (grams: string) => void;
  onText: (text: string) => void;
  onReset: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onSkip: (skip: boolean) => void;
  onOverrideGrams: (grams: string) => void;
}) {
  const isInherited = entry.kind === "inherited";
  const isIngredient = entry.kind === "ingredient";
  const custom = isIngredient && entry.custom;
  const hasTemplate = isIngredient && !!templateById.get(entry.costItemId);
  // Untouched own ingredient step shows its rendered template; editing freezes
  // to custom. Custom/free show their own text.
  const shownText = isIngredient
    ? !custom
      ? renderStep(entry, templateById)
      : entry.text ?? ""
    : entry.kind === "free"
      ? entry.text
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
        "flex items-start gap-2 rounded-xl border px-2 py-2",
        isInherited ? "bg-muted/30" : "bg-card",
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

      {isInherited ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {/* Read-only rendered step; grams flow from the override input. */}
            <div
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-muted/40 px-3 text-sm",
                excluded && "text-muted-foreground line-through",
              )}
            >
              <span className="truncate">{inheritedText || costName}</span>
            </div>
            <div className="relative w-20 shrink-0">
              <Input
                inputMode="numeric"
                value={overrideGrams == null ? "" : String(overrideGrams)}
                onChange={(e) => onOverrideGrams(filterDigits(e.target.value))}
                placeholder={basePlaceholder == null ? "—" : String(basePlaceholder)}
                aria-label={`${costName} grams override`}
                disabled={excluded}
                className="w-full pr-7 font-mono tabular-nums"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                g
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[0.7rem] text-muted-foreground">
            <span className="rounded-full bg-foreground px-2 py-0.5 font-semibold text-background">
              {sourceLabel}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
              {costName}
            </span>
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-medium">
              <input
                type="checkbox"
                checked={excluded}
                onChange={(e) => onSkip(e.target.checked)}
                className="size-4 accent-foreground"
              />
              Skip
            </label>
          </div>
        </div>
      ) : (
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
      )}

      {!isInherited && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove step"
          className="mt-1.5 rounded-sm p-1 text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}
