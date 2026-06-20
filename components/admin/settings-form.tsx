"use client";

import { useState, useTransition } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { StoreSettings } from "@/lib/settings/types";
import { updateStoreSettings } from "@/app/(admin)/admin/settings/actions";

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function SettingsForm({ initial }: { initial: StoreSettings }) {
  const [s, setS] = useState<StoreSettings>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateStoreSettings(s);
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <h2 className="font-heading text-base font-bold tracking-tight">Store status</h2>
        <ToggleRow
          label="Store open"
          hint="When off, checkout is blocked and customers see the closed message."
          checked={s.isOpen}
          onChange={(v) => setS({ ...s, isOpen: v })}
        />
        <div className="flex flex-col gap-1.5">
          <Label>Closed message</Label>
          <Textarea
            value={s.closedMessage}
            onChange={(e) => setS({ ...s, closedMessage: e.target.value })}
            rows={2}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <h2 className="font-heading text-base font-bold tracking-tight">Features</h2>
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
      </section>

      {msg && (
        <p className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{msg.text}</p>
      )}
      <button
        onClick={save}
        disabled={pending}
        className="self-start rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}
