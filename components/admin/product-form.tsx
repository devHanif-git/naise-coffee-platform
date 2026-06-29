"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/admin/image-upload";
import { AdminBackLink } from "@/components/admin/admin-back-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { saveProduct } from "@/app/(admin)/admin/menu/actions";
import { formatPrice } from "@/lib/format";
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
  const [recipeSteps, setRecipeSteps] = useState<string[]>(
    product?.recipeSteps ?? [],
  );

  // Ticked recipe ingredients -> gram amount as a string ("" = unspecified).
  // Excludes always-included items, which apply automatically.
  const [recipe, setRecipe] = useState<Map<string, string>>(
    new Map(
      product?.recipeItems.map((r) => [
        r.costItemId,
        r.amountGrams == null ? "" : String(r.amountGrams),
      ]) ?? [],
    ),
  );

  const activeCostItems = costItems.filter((c) => !c.isArchived);
  const alwaysItems = activeCostItems.filter((c) => c.alwaysIncluded);
  const optionalItems = activeCostItems.filter((c) => !c.alwaysIncluded);

  function toggleRecipe(costItemId: string) {
    setRecipe((prev) => {
      const next = new Map(prev);
      if (next.has(costItemId)) next.delete(costItemId);
      else next.set(costItemId, "");
      return next;
    });
  }

  function setGrams(costItemId: string, grams: string) {
    setRecipe((prev) => new Map(prev).set(costItemId, grams));
  }

  // Live goods cost (sen): every always-included item + each ticked optional
  // item's price. Grams are guidance and don't affect cost.
  const goodsCost =
    alwaysItems.reduce((sum, c) => sum + c.price, 0) +
    optionalItems
      .filter((c) => recipe.has(c.id))
      .reduce((sum, c) => sum + c.price, 0);

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
      recipeSteps,
      recipeItems: [...recipe.entries()].map(([costItemId, grams]) => ({
        costItemId,
        amountGrams: grams.trim() === "" ? null : Number(grams),
      })),
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
              <Input value={name} onChange={(e) => setName(e.target.value)} />
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
                onChange={(e) => setDescription(e.target.value)}
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
                onChange={(e) => setBasePrice(e.target.value)}
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
                            j === i ? { ...x, name: e.target.value } : x,
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
                            j === i ? { ...x, price: e.target.value } : x,
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

          <Panel
            title="Recipe & cost"
            hint={`Cost ${formatPrice(goodsCost)}`}
          >
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

                {/* Optional ingredients: tick to add, enter grams for staff. */}
                <div className="flex flex-col divide-y divide-border">
                  {optionalItems.map((c) => {
                    const checked = recipe.has(c.id);
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 py-2.5 text-sm"
                      >
                        <label className="flex flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRecipe(c.id)}
                            className="size-4 accent-foreground"
                          />
                          <span className={cn("flex-1", !checked && "text-muted-foreground")}>
                            {c.name}
                          </span>
                        </label>
                        {checked && (
                          <div className="relative w-20">
                            <Input
                              inputMode="numeric"
                              value={recipe.get(c.id) ?? ""}
                              onChange={(e) => setGrams(c.id, e.target.value)}
                              placeholder="0"
                              aria-label={`${c.name} grams`}
                              className="w-full pr-7 font-mono tabular-nums"
                            />
                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                              g
                            </span>
                          </div>
                        )}
                        <span
                          className={cn(
                            "w-16 shrink-0 text-right font-mono text-xs tabular-nums",
                            checked ? "text-foreground" : "text-muted-foreground/60",
                          )}
                        >
                          {formatPrice(c.price)}
                        </span>
                      </div>
                    );
                  })}
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

          <Panel title="Prep steps" hint={`${recipeSteps.length} step${recipeSteps.length === 1 ? "" : "s"}`}>
            {recipeSteps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No steps yet. Add preparation instructions for staff.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {recipeSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <Input
                      value={step}
                      onChange={(e) =>
                        setRecipeSteps((prev) =>
                          prev.map((s, j) => (j === i ? e.target.value : s)),
                        )
                      }
                      placeholder={`Step ${i + 1}`}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setRecipeSteps((prev) => prev.filter((_, j) => j !== i))
                      }
                      aria-label={`Remove step ${i + 1}`}
                      className="rounded-sm p-1 text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setRecipeSteps((prev) => [...prev, ""])}
              className="flex w-fit items-center gap-1 rounded-sm text-xs font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Plus className="size-4" /> Add step
            </button>
          </Panel>

          <Panel
            title="Add-ons"
            hint={selectedCategory ? "Defaults pre-checked" : undefined}
          >
            <Field label="Max add-ons (optional, defaults to category)">
              <Input
                inputMode="numeric"
                value={maxAddons}
                onChange={(e) => setMaxAddons(e.target.value)}
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
