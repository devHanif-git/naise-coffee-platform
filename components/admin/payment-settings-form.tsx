"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { paymentCategories, paymentMethods } from "@/data/payment-methods";
import type { PaymentSettings } from "@/lib/settings/payments";
import { updatePaymentSettings } from "@/app/(admin)/admin/settings/actions";

export function PaymentSettingsForm({ initial }: { initial: PaymentSettings }) {
  const [s, setS] = useState<PaymentSettings>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updatePaymentSettings(s);
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base font-bold tracking-tight">Payments</h2>
        <p className="text-xs text-muted-foreground">
          Turn whole categories or individual methods on or off. Disabled methods don&rsquo;t
          appear at checkout.
        </p>
      </div>

      {paymentCategories.map((cat) => {
        const methods = paymentMethods.filter((m) => m.category === cat.id);
        const catOn = s.categories[cat.id];
        return (
          <div key={cat.id} className="flex flex-col gap-3 rounded-xl bg-neutral-50 p-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-bold">{cat.label}</span>
              <Switch
                checked={catOn}
                onCheckedChange={(v) =>
                  setS({ ...s, categories: { ...s.categories, [cat.id]: v } })
                }
              />
            </div>

            <div className="flex flex-col gap-2.5 pl-1">
              {methods.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col">
                    <span
                      className={
                        catOn ? "text-sm font-medium" : "text-sm font-medium text-muted-foreground"
                      }
                    >
                      {m.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{m.description}</span>
                  </div>
                  <Switch
                    checked={s.methods[m.id]}
                    disabled={!catOn}
                    onCheckedChange={(v) =>
                      setS({ ...s, methods: { ...s.methods, [m.id]: v } })
                    }
                  />
                </div>
              ))}
            </div>

            {cat.id === "bank" && (
              <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bank-name">Bank name</Label>
                  <Input
                    id="bank-name"
                    value={s.bank.name}
                    onChange={(e) => setS({ ...s, bank: { ...s.bank, name: e.target.value } })}
                    placeholder="e.g. Maybank"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bank-account-number">Account number</Label>
                  <Input
                    id="bank-account-number"
                    value={s.bank.accountNumber}
                    onChange={(e) =>
                      setS({ ...s, bank: { ...s.bank, accountNumber: e.target.value } })
                    }
                    placeholder="e.g. 1234567890"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bank-account-holder">Account holder</Label>
                  <Input
                    id="bank-account-holder"
                    value={s.bank.accountHolder}
                    onChange={(e) =>
                      setS({ ...s, bank: { ...s.bank, accountHolder: e.target.value } })
                    }
                    placeholder="e.g. Naise Coffee Sdn Bhd"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {msg && (
        <p className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{msg.text}</p>
      )}
      <button
        onClick={save}
        disabled={pending}
        className="self-start rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save payments"}
      </button>
    </section>
  );
}
