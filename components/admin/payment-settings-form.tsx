"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { paymentCategories, paymentMethods } from "@/data/payment-methods";
import type { PaymentSettings } from "@/lib/settings/payments";
import { updatePaymentSettings, uploadDuitnowQr } from "@/app/(admin)/admin/settings/actions";
import { ImageUpload } from "@/components/admin/image-upload";
import { images } from "@/constants/images";
import { useUnsavedChanges } from "@/components/admin/unsaved-changes";

export function PaymentSettingsForm({ initial }: { initial: PaymentSettings }) {
  const [s, setS] = useState<PaymentSettings>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // No reload on save; baseline advances on success so the guard disarms.
  const current = JSON.stringify(s);
  const [saved, setSaved] = useState(current);
  useUnsavedChanges(current !== saved);

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updatePaymentSettings(s);
      if (res.ok) setSaved(current);
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-semibold">Payments</h2>
          <p className="text-xs text-muted-foreground">
            Turn whole categories or individual methods on or off. Disabled methods don&rsquo;t
            appear at checkout.
          </p>
        </div>
        <span className="shrink-0 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Checkout
        </span>
      </div>

      {paymentCategories.map((cat) => {
        const methods = paymentMethods.filter((m) => m.category === cat.id);
        const catOn = s.categories[cat.id];
        return (
          <div key={cat.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 p-3.5">
            <div className="flex items-center justify-between gap-4">
              <span className="font-heading text-sm font-semibold">{cat.label}</span>
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
                    inputMode="numeric"
                    value={s.bank.accountNumber}
                    onChange={(e) =>
                      setS({
                        ...s,
                        bank: {
                          ...s.bank,
                          // Account numbers are digits only; allow spaces/dashes
                          // for readability, strip anything else as they type.
                          accountNumber: e.target.value.replace(/[^0-9\s-]/g, ""),
                        },
                      })
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

            {cat.id === "qr" && (
              <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold">DuitNow QR image</span>
                  <span className="text-xs text-muted-foreground">
                    Shown at checkout when DuitNow QR is selected. Leave empty to
                    use the built-in QR.
                  </span>
                </div>
                <ImageUpload
                  value={s.duitnowQrUrl}
                  onChange={(url) => setS({ ...s, duitnowQrUrl: url })}
                  upload={uploadDuitnowQr}
                  placeholder={images.qrDuitnow}
                  alt="DuitNow QR code"
                />
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-muted/40 p-3.5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-heading text-sm font-semibold">Allow &ldquo;Pay later&rdquo; at kiosk</span>
          <span className="text-xs text-muted-foreground">
            Staff can place a store order before payment is decided, then set it later.
          </span>
        </div>
        <Switch
          checked={s.payLaterEnabled}
          onCheckedChange={(v) => setS({ ...s, payLaterEnabled: v })}
        />
      </div>

      {msg && (
        <p className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>{msg.text}</p>
      )}
      <Button onClick={save} disabled={pending} className="self-start rounded-full">
        {pending ? "Saving..." : "Save payments"}
      </Button>
    </section>
  );
}
