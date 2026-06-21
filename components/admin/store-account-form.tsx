"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import {
  setStorePasscode,
  setStoreEnabled,
} from "@/app/(admin)/admin/settings/store-account-actions";

export function StoreAccountForm({
  initial,
}: {
  initial: { isEnabled: boolean; isProvisioned: boolean; lastRotatedAt: string | null };
}) {
  const [enabled, setEnabled] = useState(initial.isEnabled);
  const [passcode, setPasscode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function savePasscode() {
    setMsg(null);
    startTransition(async () => {
      const res = await setStorePasscode(passcode);
      setMsg(res.ok ? "Passcode updated." : res.error);
      if (res.ok) setPasscode("");
    });
  }

  function toggleEnabled(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const res = await setStoreEnabled(next);
      if (!res.ok) {
        setEnabled(!next);
        setMsg(res.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base font-semibold">Store Ordering</h2>
        <p className="text-xs text-muted-foreground">
          A shared passcode login for the in-store kiosk tablet. Orders placed here
          earn no rewards and are tagged as in-store.
        </p>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Enabled</span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => toggleEnabled(e.target.checked)}
          className="size-5"
          aria-label="Enable store ordering"
        />
      </label>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="store-passcode">
          {initial.isProvisioned ? "Rotate passcode" : "Set passcode"}
        </label>
        <Input
          id="store-passcode"
          type="password"
          autoComplete="new-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="At least 6 characters"
        />
        <button
          type="button"
          onClick={savePasscode}
          disabled={pending || passcode.trim().length < 6}
          className="h-10 rounded-xl bg-black px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          Save passcode
        </button>
        <p className="text-[0.6875rem] text-muted-foreground">
          To force tablets onto a new passcode: disable, save the new passcode, then
          enable again.
        </p>
        {initial.lastRotatedAt && (
          <p className="text-[0.6875rem] text-muted-foreground">
            Last rotated: {new Date(initial.lastRotatedAt).toLocaleString()}
          </p>
        )}
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </section>
  );
}
