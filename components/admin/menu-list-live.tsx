"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { SmartImage } from "@/components/ui/smart-image";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { images } from "@/constants/images";
import type { AdminCategory, AdminProduct } from "@/lib/menu/types";
import {
  setAvailability,
  setFlag,
  setArchived,
} from "@/app/(admin)/admin/menu/actions";

export function MenuListLive({
  products,
  categories,
}: {
  products: AdminProduct[];
  categories: AdminCategory[];
}) {
  const [rows, setRows] = useState(products);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [, startTransition] = useTransition();

  const visible = rows.filter((p) => {
    if (!showArchived && p.isArchived) return false;
    const q = query.trim().toLowerCase();
    return q === "" || p.name.toLowerCase().includes(q);
  });

  function patch(id: string, next: Partial<AdminProduct>) {
    setRows((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
  }

  function onAvailability(p: AdminProduct, value: boolean) {
    patch(p.id, { isAvailable: value });
    startTransition(async () => {
      try {
        const res = await setAvailability(p.id, value);
        if (!res.ok) patch(p.id, { isAvailable: !value });
      } catch {
        patch(p.id, { isAvailable: !value });
      }
    });
  }

  function onFlag(
    p: AdminProduct,
    flag: "best_seller" | "new" | "featured",
    value: boolean,
  ) {
    const key =
      flag === "best_seller"
        ? "isBestSeller"
        : flag === "new"
          ? "isNew"
          : "isFeatured";
    patch(p.id, { [key]: value } as Partial<AdminProduct>);
    startTransition(async () => {
      try {
        const res = await setFlag(p.id, flag, value);
        if (!res.ok) patch(p.id, { [key]: !value } as Partial<AdminProduct>);
      } catch {
        patch(p.id, { [key]: !value } as Partial<AdminProduct>);
      }
    });
  }

  function onArchiveToggle(p: AdminProduct) {
    const value = !p.isArchived;
    patch(p.id, { isArchived: value });
    startTransition(async () => {
      try {
        const res = await setArchived(p.id, value);
        if (!res.ok) patch(p.id, { isArchived: !value });
      } catch {
        patch(p.id, { isArchived: !value });
      }
    });
  }

  const byCategory = categories.map((c) => ({
    category: c,
    items: visible.filter((p) => p.categoryId === c.id),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items..."
            aria-label="Search items"
            className="h-10 pl-10"
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show
          archived
        </label>
      </div>

      {byCategory.map(({ category, items }) => (
        <section key={category.id} className="flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {category.name}
          </h2>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border border-border bg-card p-3 transition-colors",
                    p.isArchived && "opacity-50",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                      <SmartImage
                        src={p.imageUrl ?? images.coffeeWithLogo}
                        alt={p.name}
                        fill
                        sizes="48px"
                        className="object-contain"
                      />
                    </div>
                    <Link
                      href={`/admin/menu/${p.id}`}
                      className="flex min-w-0 flex-1 flex-col rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="truncate text-sm font-semibold">
                        {p.name}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {formatPrice(p.fromPrice)}
                      </span>
                    </Link>
                    <label className="flex flex-col items-center gap-1 text-xs font-medium text-muted-foreground">
                      Available
                      <Switch
                        checked={p.isAvailable}
                        onCheckedChange={(v) => onAvailability(p, v)}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FlagChip
                      label="Best Seller"
                      active={p.isBestSeller}
                      onClick={() => onFlag(p, "best_seller", !p.isBestSeller)}
                    />
                    <FlagChip
                      label="New"
                      active={p.isNew}
                      onClick={() => onFlag(p, "new", !p.isNew)}
                    />
                    <FlagChip
                      label="Featured"
                      active={p.isFeatured}
                      onClick={() => onFlag(p, "featured", !p.isFeatured)}
                    />
                    <button
                      onClick={() => onArchiveToggle(p)}
                      className="ml-auto rounded-sm text-xs font-semibold text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {p.isArchived ? "Restore" : "Archive"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function FlagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
