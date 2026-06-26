"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SmartImage } from "@/components/ui/smart-image";
import { Switch } from "@/components/ui/switch";
import { SearchInput } from "@/components/ui/search-input";
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

  // Per-control in-flight lock. Keys are `${productId}:${field}` so each toggle
  // on each row settles independently — flipping availability never freezes the
  // Best Seller chip, and two different items stay independently operable.
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const isBusy = (id: string, field: string) => busyKeys.has(`${id}:${field}`);
  function withBusy(key: string, run: () => Promise<void>) {
    setBusyKeys((prev) => new Set(prev).add(key));
    startTransition(async () => {
      try {
        await run();
      } finally {
        setBusyKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    });
  }

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
    withBusy(`${p.id}:availability`, async () => {
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
    withBusy(`${p.id}:${flag}`, async () => {
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
    withBusy(`${p.id}:archive`, async () => {
      try {
        const res = await setArchived(p.id, value);
        if (!res.ok) patch(p.id, { isArchived: !value });
      } catch {
        patch(p.id, { isArchived: !value });
      }
    });
  }

  const live = rows.filter((p) => !p.isArchived);
  const counts = {
    items: live.length,
    available: live.filter((p) => p.isAvailable).length,
    hidden: live.filter((p) => !p.isAvailable).length,
    archived: rows.filter((p) => p.isArchived).length,
  };

  const byCategory = categories
    .map((c) => ({
      category: c,
      items: visible.filter((p) => p.categoryId === c.id),
    }))
    .filter(({ items }) => items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Roster summary — Hidden carries the amber accent: items customers
          can't currently order, the thing a manager scans for. */}
      <div className="flex flex-wrap items-center gap-2">
        <Stat value={counts.items} label="items" />
        <Stat value={counts.available} label="available" tone="ok" />
        <Stat value={counts.hidden} label="hidden" tone="warn" />
        <Stat value={counts.archived} label="archived" tone="muted" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search items..."
          aria-label="Search items"
          containerClassName="w-full sm:max-w-xs"
          className="h-10 rounded-full"
        />
        <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show
          archived
        </label>
      </div>

      {byCategory.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-12 text-center text-sm text-muted-foreground">
          {query.trim()
            ? `No items match “${query.trim()}”.`
            : "No items yet."}
        </div>
      ) : (
        byCategory.map(({ category, items }) => (
          <section key={category.id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold">
                {category.name}
              </h2>
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {items.length} item{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-2xl border border-border bg-card p-3.5 transition-colors",
                    p.isArchived && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                      <SmartImage
                        src={p.imageUrl ?? images.coffeeWithLogo}
                        alt={p.name}
                        fill
                        sizes="56px"
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
                      <span className="font-mono text-sm font-medium text-muted-foreground tabular-nums">
                        {formatPrice(p.fromPrice)}
                      </span>
                    </Link>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Switch
                        checked={p.isAvailable}
                        disabled={isBusy(p.id, "availability")}
                        onCheckedChange={(v) => onAvailability(p, v)}
                        aria-label={`${p.name} available`}
                      />
                      <span
                        className={cn(
                          "flex items-center gap-1 text-[0.7rem] font-semibold",
                          p.isAvailable ? "text-emerald-600" : "text-amber-600",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            p.isAvailable ? "bg-emerald-500" : "bg-amber-500",
                          )}
                        />
                        {p.isAvailable ? "Available" : "Hidden"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                    <FlagChip
                      label="Best Seller"
                      active={p.isBestSeller}
                      disabled={isBusy(p.id, "best_seller")}
                      onClick={() => onFlag(p, "best_seller", !p.isBestSeller)}
                    />
                    <FlagChip
                      label="New"
                      active={p.isNew}
                      disabled={isBusy(p.id, "new")}
                      onClick={() => onFlag(p, "new", !p.isNew)}
                    />
                    <button
                      onClick={() => onArchiveToggle(p)}
                      disabled={isBusy(p.id, "archive")}
                      className="ml-auto rounded-sm text-xs font-semibold text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 disabled:no-underline"
                    >
                      {p.isArchived ? "Restore" : "Archive"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

// Compact roster figure: mono count + label, with an optional status tone.
function Stat({
  value,
  label,
  tone = "default",
}: {
  value: number;
  label: string;
  tone?: "default" | "ok" | "warn" | "muted";
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm">
      <span
        className={cn(
          "font-mono font-bold tabular-nums",
          tone === "warn" && value > 0
            ? "text-amber-600"
            : tone === "ok"
              ? "text-emerald-600"
              : tone === "muted"
                ? "text-muted-foreground"
                : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function FlagChip({
  label,
  active,
  onClick,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
