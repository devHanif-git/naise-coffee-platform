"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { capitalizeFirst } from "@/lib/format";
import type { StoreSettings } from "@/lib/settings/types";
import { updateStoreSettings } from "@/app/(admin)/admin/settings/actions";
import { useUnsavedChanges } from "@/components/admin/unsaved-changes";

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  badge,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          {label}
          {badge}
        </span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </span>
  );
}

export function SettingsForm({ initial }: { initial: StoreSettings }) {
  const [s, setS] = useState<StoreSettings>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Baseline advances on a successful save (this form does not reload), so the
  // guard disarms once edits are persisted.
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(s) !== saved;
  useUnsavedChanges(dirty);

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateStoreSettings(s);
      if (res.ok) setSaved(JSON.stringify(s));
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base font-semibold">Store details</h2>
          <Eyebrow>Storefront</Eyebrow>
        </div>
        <div className="flex flex-col">
          <ToggleRow
            label="Store open"
            hint="When off, checkout is blocked and customers see the closed message."
            checked={s.isOpen}
            onChange={(v) => setS({ ...s, isOpen: v })}
            badge={
              <span
                className={
                  s.isOpen
                    ? "inline-flex items-center gap-1 text-[0.7rem] font-semibold text-emerald-600"
                    : "inline-flex items-center gap-1 text-[0.7rem] font-semibold text-destructive"
                }
              >
                <span
                  className={
                    s.isOpen ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-destructive"
                  }
                />
                {s.isOpen ? "Open" : "Closed"}
              </span>
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Closed message</Label>
          <Textarea
            value={s.closedMessage}
            onChange={(e) => setS({ ...s, closedMessage: capitalizeFirst(e.target.value) })}
            rows={2}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base font-semibold">Features</h2>
          <Eyebrow>Customer app</Eyebrow>
        </div>
        <div className="flex flex-col divide-y divide-border">
          <ToggleRow
            label="Rewards"
            hint="Show the Rewards tab, page, and Beans banner."
            checked={s.rewardsEnabled}
            onChange={(v) => setS({ ...s, rewardsEnabled: v })}
          />
          <ToggleRow
            label="Referral"
            hint="Show the referral card on the Rewards page."
            checked={s.referralEnabled}
            onChange={(v) => setS({ ...s, referralEnabled: v })}
          />
          <ToggleRow
            label="Daily streak"
            hint="Show the streak widget on the Rewards page."
            checked={s.streakEnabled}
            onChange={(v) => setS({ ...s, streakEnabled: v })}
          />
        </div>
      </section>

      {msg && (
        <p className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>{msg.text}</p>
      )}
      <Button onClick={save} disabled={pending} className="self-start rounded-full">
        {pending ? "Saving..." : "Save settings"}
      </Button>
    </div>
  );
}
