"use client";

import { useState, useTransition } from "react";
import { saveStampSettings, type StampSettingsInput } from "@/app/(admin)/admin/promotions/stamp-actions";
import type { StampSettings } from "@/types/reward";

export function StampSettingsForm({ initial }: { initial: StampSettings }) {
  const [form, setForm] = useState<StampSettingsInput>({
    isEnabled: initial.isEnabled,
    cardSize: initial.cardSize,
    milestoneSmall: initial.milestoneSmall,
    rmOffAmount: initial.rmOffAmount,
    rmOffMinSpend: initial.rmOffMinSpend,
    freeDrinkMaxValue: initial.freeDrinkMaxValue,
    voucherExpiryDays: initial.voucherExpiryDays,
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    start(async () => {
      const res = await saveStampSettings(form);
      setMsg(res.ok ? "Saved" : res.error);
    });
  }

  const rm = (sen: number) => (sen / 100).toFixed(2);
  const toSen = (rm: string) => Math.round(parseFloat(rm || "0") * 100);

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider">Stamp Card &amp; Vouchers</h2>

      <label className="mt-4 flex items-center justify-between gap-4">
        <span className="text-sm">Program enabled</span>
        <input type="checkbox" checked={form.isEnabled}
          onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />
      </label>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <NumberField label="Card size" value={form.cardSize}
          onChange={(v) => setForm({ ...form, cardSize: v })} />
        <NumberField label="Reward at (stamps)" value={form.milestoneSmall}
          onChange={(v) => setForm({ ...form, milestoneSmall: v })} />
        <MoneyField label="RM off (RM)" value={rm(form.rmOffAmount)}
          onChange={(v) => setForm({ ...form, rmOffAmount: toSen(v) })} />
        <MoneyField label="Min spend (RM)" value={rm(form.rmOffMinSpend)}
          onChange={(v) => setForm({ ...form, rmOffMinSpend: toSen(v) })} />
        <MoneyField label="Free drink cap (RM)" value={rm(form.freeDrinkMaxValue)}
          onChange={(v) => setForm({ ...form, freeDrinkMaxValue: toSen(v) })} />
        <NumberField label="Voucher expiry (days)" value={form.voucherExpiryDays}
          onChange={(v) => setForm({ ...form, voucherExpiryDays: v })} />
      </div>

      <button type="button" onClick={save} disabled={pending}
        className="mt-4 h-11 rounded-2xl bg-foreground px-6 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-70">
        {pending ? "Saving" : "Save"}
      </button>
      {msg && <p className="mt-2 text-xs">{msg}</p>}
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type="number" min={0} value={value}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="h-11 rounded-xl border border-border px-3 text-sm" />
    </label>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type="text" inputMode="decimal" value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-border px-3 text-sm" />
    </label>
  );
}
