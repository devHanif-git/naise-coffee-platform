"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminLoyaltySettings } from "@/lib/rewards/types";
import { updateLoyaltySettings } from "@/app/(admin)/admin/rewards/actions";

export function LoyaltySettingsForm({ initial }: { initial: AdminLoyaltySettings }) {
  const [beansPerRinggit, setBeans] = useState(String(initial.beansPerRinggit));
  const [referralBeans, setReferralBeans] = useState(String(initial.referralBeans));
  const [voucher, setVoucher] = useState(initial.referralVoucherLabel);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateLoyaltySettings({
        beansPerRinggit: Number(beansPerRinggit),
        referralBeans: Number(referralBeans),
        referralVoucherLabel: voucher,
      });
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-base font-semibold">Loyalty settings</h2>
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Earning
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Beans per RM1</Label>
        <Input inputMode="numeric" value={beansPerRinggit} onChange={(e) => setBeans(e.target.value)} className="w-28 font-mono tabular-nums" />
        <p className="text-xs text-muted-foreground">Applies to future orders only. The Beans ledger is immutable.</p>
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Referral beans</Label>
          <Input inputMode="numeric" value={referralBeans} onChange={(e) => setReferralBeans(e.target.value)} className="font-mono tabular-nums" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Voucher label</Label>
          <Input value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="RM5 Voucher" />
        </div>
      </div>
      {msg && <p className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>{msg.text}</p>}
      <Button onClick={save} disabled={pending} className="self-start rounded-full">
        {pending ? "Saving..." : "Save settings"}
      </Button>
    </section>
  );
}
