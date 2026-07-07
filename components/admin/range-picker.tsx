"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import type { AnalyticsRange } from "@/lib/analytics/types";
import {
  rangePresets,
  presetToRange,
  matchPreset,
  sanitizeRange,
  klToday,
  type RangePresetKey,
} from "@/lib/analytics/range";
import { cn } from "@/lib/utils";

export function RangePicker({
  value,
  onChange,
  disabled,
}: {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
  disabled?: boolean;
}) {
  const active = matchPreset(value);
  const [customOpen, setCustomOpen] = useState(active === null);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const today = klToday();

  function pickPreset(key: RangePresetKey) {
    setCustomOpen(false);
    onChange(presetToRange(key));
  }

  function applyCustom() {
    const next = sanitizeRange({ from, to });
    setFrom(next.from);
    setTo(next.to);
    onChange(next);
  }

  const pillBase =
    "rounded-full px-3.5 py-1.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {rangePresets.map((p) => {
          const on = !customOpen && active === p.value;
          return (
            <button
              key={p.value}
              type="button"
              disabled={disabled}
              onClick={() => pickPreset(p.value)}
              aria-pressed={on}
              className={cn(
                pillBase,
                on
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCustomOpen((v) => !v)}
          aria-pressed={customOpen}
          className={cn(
            pillBase,
            "inline-flex items-center gap-1.5",
            customOpen
              ? "bg-foreground text-background"
              : "border border-border text-muted-foreground hover:bg-muted",
          )}
        >
          <Calendar className="size-4" aria-hidden />
          Custom
        </button>
      </div>

      {customOpen && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            From
            <input
              type="date"
              value={from}
              max={to || today}
              disabled={disabled}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            To
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              disabled={disabled}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <button
            type="button"
            disabled={disabled || !from || !to}
            onClick={applyCustom}
            className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-semibold text-background outline-none transition-colors hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
