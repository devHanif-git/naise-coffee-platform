"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, Check, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { filterDigits, filterDecimal } from "@/lib/input";
import { capitalizeWords, capitalizeFirst } from "@/lib/format";
import { ImageUpload } from "@/components/admin/image-upload";
import { AdminBackLink } from "@/components/admin/admin-back-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { saveProduct } from "@/app/(admin)/admin/menu/actions";
import { formatPrice } from "@/lib/format";
import { deriveGoodsCost, renderStep, type RecipeEntry } from "@/lib/menu/recipe";
import type {
  AdminAddon,
  AdminCategory,
  AdminCostItem,
  AdminProductDetail,
  ProductFormData,
} from "@/lib/menu/types";

// Convert RM string <-> sen for the price inputs.
const toSen = (rm: string) => Math.round(parseFloat(rm || "0") * 100);
const toRm = (sen: number | null) => (sen == null ? "" : (sen / 100).toFixed(2));

export function ProductForm({
  product,
  categories,
  addons,
  costItems,
}: {
  product: AdminProductDetail | null;
  categories: AdminCategory[];
  addons: AdminAddon[];
  costItems: AdminCostItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(
    product?.categoryId ?? categories[0]?.id ?? "",
  );
  const [imageUrl, setImageUrl] = useState<string | null>(product?.imageUrl ?? null);
  const [pricingMode, setPricingMode] = useState<"variants" | "flat">(
    product ? (product.variants.length > 0 ? "variants" : "flat") : "variants",
  );
  const [basePrice, setBasePrice] = useState(toRm(product?.basePrice ?? null));
  const [variants, setVariants] = useState(
    product?.variants.map((v) => ({ name: v.name, price: toRm(v.price) })) ?? [
      { name: "Regular", price: "" },
    ],
  );
  const [maxAddons, setMaxAddons] = useState(
    product?.maxAddons != null ? String(product.maxAddons) : "",
  );
  const [isBestSeller, setIsBestSeller] = useState(product?.isBestSeller ?? false);
  const [isNew, setIsNew] = useState(product?.isNew ?? false);
  // Featured has no storefront surface yet; preserve the saved value on edit
  // without exposing a control. Re-add a ToggleRow when the section ships.
  const [isFeatured] = useState(product?.isFeatured ?? false);
  const [isAvailable, setIsAvailable] = useState(product?.isAvailable ?? true);

  // Ordered, unified recipe list (ingredient steps + free-text steps).
  const [recipe, setRecipe] = useState<RecipeEntry[]>(product?.recipe ?? []);
  const templateById = new Map(costItems.map((c) => [c.id, c.prepTemplate]));

  const activeCostItems = costItems.filter((c) => !c.isArchived);
  const alwaysItems = activeCostItems.filter((c) => c.alwaysIncluded);
  const optionalItems = activeCostItems.filter((c) => !c.alwaysIncluded);

  // Which optional cost items are currently in the list (as ingredient steps).
  const tickedIds = new Set(
    recipe.flatMap((e) => (e.kind === "ingredient" ? [e.costItemId] : [])),
  );

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

  // Pointer-drag reordering with a lift + drop-line. The grabbed row follows the
  // pointer (see RecipeStepRow); other rows stay put so nothing jumps, and a
  // drop line marks the landing slot. We commit only on release.
  //   from  — index being dragged
  //   offset— pixels the row has moved from its resting position
  //   drop  — insertion index (0..length) the pointer is currently over
  const [drag, setDrag] = useState<{ from: number; offset: number; drop: number } | null>(null);
  // Row vertical centers captured at drag start (rows don't move mid-drag).
  const dragCenters = useRef<number[]>([]);
  const dragStartY = useRef(0);

  function startDrag(index: number, e: React.PointerEvent) {
    e.preventDefault();
    const li = (e.currentTarget as HTMLElement).closest("li");
    const list = li?.parentElement;
    if (!li || !list) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>("li[data-step]"));
    dragCenters.current = rows.map((r) => {
      const rect = r.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    dragStartY.current = e.clientY;
    setDrag({ from: index, offset: 0, drop: index });

    const onMove = (ev: PointerEvent) => {
      const offset = ev.clientY - dragStartY.current;
      let drop = dragCenters.current.findIndex((c) => ev.clientY < c);
      if (drop === -1) drop = dragCenters.current.length;
      setDrag((d) => (d ? { ...d, offset, drop } : d));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag((d) => {
        if (d) {
          // `drop` is an insertion index into the full list; once the dragged
          // row is pulled out, targets past it shift down by one.
          const to = d.drop > d.from ? d.drop - 1 : d.drop;
          if (to !== d.from) {
            setRecipe((prev) => {
              const next = [...prev];
              const [moved] = next.splice(d.from, 1);
              next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
              return next;
            });
          }
        }
        return null;
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
        return { ...e, text, custom: true };
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

  // Live goods cost (sen): ticked ingredients + every always-included item.
  const goodsCost = deriveGoodsCost(
    recipe,
    activeCostItems.map((c) => ({
      id: c.id,
      price: c.price,
      alwaysIncluded: c.alwaysIncluded,
      isArchived: c.isArchived,
    })),
  );

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const [overrides, setOverrides] = useState<Map<string, "add" | "remove">>(
    new Map(product?.addonOverrides.map((o) => [o.addonId, o.mode]) ?? []),
  );

  function isChecked(addonId: string): boolean {
    const mode = overrides.get(addonId);
    const isDefault = selectedCategory?.addonIds.includes(addonId) ?? false;
    if (mode === "add") return true;
    if (mode === "remove") return false;
    return isDefault;
  }

  function toggleAddon(addonId: string) {
    const isDefault = selectedCategory?.addonIds.includes(addonId) ?? false;
    const next = new Map(overrides);
    const checkedNow = isChecked(addonId);
    if (checkedNow) {
      if (isDefault) next.set(addonId, "remove");
      else next.delete(addonId);
    } else {
      if (isDefault) next.delete(addonId);
      else next.set(addonId, "add");
    }
    setOverrides(next);
  }

  function submit() {
    setError(null);
    const data: ProductFormData = {
      id: product?.id,
      name,
      slug,
      description,
      categoryId,
      imageUrl,
      pricingMode,
      basePrice: pricingMode === "flat" ? toSen(basePrice) : null,
      variants:
        pricingMode === "variants"
          ? variants.map((v) => ({ name: v.name, price: toSen(v.price) }))
          : [],
      maxAddons: maxAddons.trim() === "" ? null : Number(maxAddons),
      isBestSeller,
      isNew,
      isFeatured,
      isAvailable,
      addonOverrides: [...overrides.entries()].map(([addonId, mode]) => ({
        addonId,
        mode,
      })),
      recipe,
    };
    startTransition(async () => {
      try {
        const res = await saveProduct(data);
        if (res.ok) router.push("/admin/menu");
        else setError(res.error);
      } catch {
        setError("Save failed. Please try again.");
      }
    });
  }

  const activeAddons = addons.filter((a) => !a.isArchived);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <AdminBackLink href="/admin/menu" label="Back to Menu" />
      <AdminPageHeader
        title={product ? "Edit item" : "New item"}
        description="Details, pricing, add-ons, and where it shows."
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* Main column — the substance of the item. */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel title="Details">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(capitalizeWords(e.target.value))} />
            </Field>
            <Field label="Slug (optional, auto from name)">
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="auto"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(capitalizeFirst(e.target.value))}
                rows={3}
              />
            </Field>
            <Field label="Category">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {categories
                  .filter((c) => !c.isArchived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
          </Panel>

          <Panel
            title="Pricing"
            hint={pricingMode === "variants" ? "By size" : "Flat"}
          >
            <div className="flex gap-2">
              <ModeButton
                active={pricingMode === "variants"}
                onClick={() => setPricingMode("variants")}
              >
                Sizes
              </ModeButton>
              <ModeButton
                active={pricingMode === "flat"}
                onClick={() => setPricingMode("flat")}
              >
                Flat price
              </ModeButton>
            </div>
            {pricingMode === "flat" ? (
              <Input
                inputMode="decimal"
                value={basePrice}
                onChange={(e) => setBasePrice(filterDecimal(e.target.value, basePrice))}
                placeholder="0.00"
                className="w-32 font-mono tabular-nums"
              />
            ) : (
              <div className="flex flex-col gap-2">
                {variants.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={v.name}
                      onChange={(e) =>
                        setVariants((p) =>
                          p.map((x, j) =>
                            j === i ? { ...x, name: capitalizeWords(e.target.value) } : x,
                          ),
                        )
                      }
                      placeholder="Size name"
                      className="flex-1"
                    />
                    <Input
                      inputMode="decimal"
                      value={v.price}
                      onChange={(e) =>
                        setVariants((p) =>
                          p.map((x, j) =>
                            j === i ? { ...x, price: filterDecimal(e.target.value, x.price) } : x,
                          ),
                        )
                      }
                      placeholder="0.00"
                      className="w-24 font-mono tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setVariants((p) => p.filter((_, j) => j !== i))
                      }
                      aria-label="Remove size"
                      className="rounded-sm p-1 text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setVariants((p) => [...p, { name: "", price: "" }])
                  }
                  className="flex w-fit items-center gap-1 rounded-sm text-xs font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Plus className="size-4" /> Add size
                </button>
              </div>
            )}
          </Panel>

          <Panel title="Recipe" hint={`Cost ${formatPrice(goodsCost)}`}>
            {activeCostItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No cost items yet. Create them under Cost Goods to build a recipe.
              </p>
            ) : (
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
                  {recipe.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      Tick an ingredient above or add a step. Drag to reorder.
                    </p>
                  ) : (
                    <ol className="relative flex flex-col gap-2">
                      {recipe.map((entry, i) => (
                        <div key={i} className="contents">
                          {/* Drop line before this slot while dragging. Hidden
                              at the two positions that wouldn't move the row. */}
                          {drag &&
                            drag.drop === i &&
                            i !== drag.from &&
                            i !== drag.from + 1 && <DropLine />}
                          <RecipeStepRow
                            index={i}
                            total={recipe.length}
                            entry={entry}
                            templateById={templateById}
                            costName={
                              entry.kind === "ingredient"
                                ? activeCostItems.find((c) => c.id === entry.costItemId)?.name ??
                                  "Ingredient"
                                : ""
                            }
                            dragging={drag?.from === i}
                            dragOffset={drag?.from === i ? drag.offset : 0}
                            onGrams={(g) => setGramsAt(i, g)}
                            onText={(t) => setTextAt(i, t)}
                            onReset={() => resetToTemplate(i)}
                            onRemove={() => removeAt(i)}
                            onMove={(dir) => move(i, dir)}
                            onDragStart={(e) => startDrag(i, e)}
                          />
                        </div>
                      ))}
                      {/* Drop line at the very end. */}
                      {drag &&
                        drag.drop === recipe.length &&
                        drag.from !== recipe.length - 1 && <DropLine />}
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
            )}
          </Panel>

          <Panel
            title="Add-ons"
            hint={selectedCategory ? "Defaults pre-checked" : undefined}
          >
            <Field label="Max add-ons (optional, defaults to category)">
              <Input
                inputMode="numeric"
                value={maxAddons}
                onChange={(e) => setMaxAddons(filterDigits(e.target.value))}
                placeholder={String(selectedCategory?.maxAddons ?? 3)}
                className="w-24 font-mono tabular-nums"
              />
            </Field>
            {activeAddons.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No add-ons yet. Create them under Add-ons.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {activeAddons.map((a) => {
                  const checked = isChecked(a.id);
                  return (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-3 py-2.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAddon(a.id)}
                        className="size-4 accent-foreground"
                      />
                      <span
                        className={cn(
                          "flex-1",
                          !checked && "text-muted-foreground",
                        )}
                      >
                        {a.name}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        RM {toRm(a.price)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        {/* Side column — image and where it surfaces. */}
        <div className="flex flex-col gap-4">
          <Panel title="Image">
            <ImageUpload value={imageUrl} onChange={setImageUrl} />
          </Panel>

          <Panel title="Visibility">
            <div className="flex flex-col divide-y divide-border">
              <ToggleRow
                label="Available"
                checked={isAvailable}
                onChange={setIsAvailable}
              />
              <ToggleRow
                label="Best Seller"
                checked={isBestSeller}
                onChange={setIsBestSeller}
              />
              <ToggleRow label="New" checked={isNew} onChange={setIsNew} />
            </div>
          </Panel>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Sticky action bar — Save stays reachable on long forms. */}
      <div className="sticky bottom-4 z-10 flex gap-2 rounded-2xl border border-border bg-background/85 p-3 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 rounded-full"
          onClick={() => router.push("/admin/menu")}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="h-11 flex-1 rounded-full"
          onClick={submit}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save item"}
        </Button>
      </div>
    </div>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        {hint && (
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-2.5 text-sm font-medium">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

// A drop indicator line shown between rows while dragging, marking where the
// grabbed step will land.
function DropLine() {
  return (
    <li aria-hidden className="pointer-events-none -my-1 flex items-center gap-2 px-1">
      <span className="size-2 rounded-full bg-primary" />
      <span className="h-0.5 flex-1 rounded-full bg-primary" />
    </li>
  );
}

// One row in the ordered recipe list: drag handle + up/down for reorder, an
// editable body (ingredient steps render from their template with grams inline;
// free steps are plain text), and a remove control. While its own row is being
// dragged it lifts and follows the pointer.
function RecipeStepRow({
  index,
  total,
  entry,
  templateById,
  costName,
  dragging,
  dragOffset,
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
  dragging: boolean;
  dragOffset: number;
  onGrams: (grams: string) => void;
  onText: (text: string) => void;
  onReset: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const isIngredient = entry.kind === "ingredient";
  const custom = isIngredient && entry.custom;
  const hasTemplate = isIngredient && !!templateById.get(entry.costItemId);
  // Untouched ingredient step shows its rendered template as the input value;
  // editing it freezes to custom. Custom/free show their own text.
  const shownText =
    isIngredient && !custom ? renderStep(entry, templateById) : entry.text ?? "";

  return (
    <li
      data-step
      style={dragging ? { transform: `translateY(${dragOffset}px)` } : undefined}
      className={cn(
        "flex items-start gap-2 rounded-xl border bg-card px-2 py-2",
        dragging
          ? "relative z-10 border-primary shadow-lg ring-2 ring-primary/30 [&_input]:pointer-events-none"
          : "border-border transition-transform",
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
