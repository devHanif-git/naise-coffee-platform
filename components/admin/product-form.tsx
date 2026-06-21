"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/admin/image-upload";
import { AdminBackLink } from "@/components/admin/admin-back-link";
import { saveProduct } from "@/app/(admin)/admin/menu/actions";
import type {
  AdminAddon,
  AdminCategory,
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
}: {
  product: AdminProductDetail | null;
  categories: AdminCategory[];
  addons: AdminAddon[];
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
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  const [isAvailable, setIsAvailable] = useState(product?.isAvailable ?? true);

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

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <AdminBackLink href="/admin/menu" label="Back to Menu" />
      <h1 className="font-heading text-xl font-bold tracking-tight">
        {product ? "Edit item" : "New item"}
      </h1>

      <ImageUpload value={imageUrl} onChange={setImageUrl} />

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
          rows={2}
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

      <div className="flex flex-col gap-2">
        <Label>Pricing</Label>
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
                  className="w-24"
                />
                <button
                  type="button"
                  onClick={() => setVariants((p) => p.filter((_, j) => j !== i))}
                  aria-label="Remove size"
                  className="text-muted-foreground"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setVariants((p) => [...p, { name: "", price: "" }])}
              className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"
            >
              <Plus className="size-4" /> Add size
            </button>
          </div>
        )}
      </div>

      <Field label="Max add-ons (optional, defaults to category)">
        <Input
          inputMode="numeric"
          value={maxAddons}
          onChange={(e) => setMaxAddons(e.target.value)}
          placeholder={String(selectedCategory?.maxAddons ?? 3)}
          className="w-24"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <Label>
          Add-ons{" "}
          {selectedCategory && (
            <span className="font-normal text-muted-foreground">
              (category defaults pre-checked)
            </span>
          )}
        </Label>
        <div className="flex flex-col gap-1">
          {addons
            .filter((a) => !a.isArchived)
            .map((a) => (
              <label key={a.id} className="flex items-center gap-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={isChecked(a.id)}
                  onChange={() => toggleAddon(a.id)}
                  className="size-4"
                />
                <span className="flex-1">{a.name}</span>
                <span className="text-xs text-muted-foreground">
                  {toRm(a.price)}
                </span>
              </label>
            ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
        <ToggleRow label="Available" checked={isAvailable} onChange={setIsAvailable} />
        <ToggleRow label="Best Seller" checked={isBestSeller} onChange={setIsBestSeller} />
        <ToggleRow label="New" checked={isNew} onChange={setIsNew} />
        <ToggleRow label="Featured" checked={isFeatured} onChange={setIsFeatured} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1"
          onClick={() => router.push("/admin/menu")}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="h-11 flex-1"
          onClick={submit}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
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
    <label className="flex items-center justify-between text-sm font-medium">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
