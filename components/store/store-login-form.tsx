"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STORE_ACCOUNT_EMAIL } from "@/constants/store";

// `disabled` = a store session exists but admin turned ordering off. We sign the
// device's local session out so re-enabling forces a fresh passcode entry.
export function StoreLoginForm({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (disabled) {
      createClient().auth.signOut();
    }
  }, [disabled]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: STORE_ACCOUNT_EMAIL,
        password: passcode,
      });
      if (error) {
        setError("Incorrect passcode.");
        return;
      }
      router.push("/store");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-heading text-2xl font-bold uppercase tracking-[0.2em]">
        Naise Store
      </h1>
      {disabled ? (
        <p className="text-center text-sm text-muted-foreground">
          Store ordering is currently off. Ask a manager.
        </p>
      ) : (
        <div className="flex w-full max-w-xs flex-col gap-3">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Enter passcode"
            aria-label="Store passcode"
            className="h-14 rounded-2xl border border-border bg-white px-4 text-center text-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending || passcode.length < 6}
            className="h-14 rounded-2xl bg-black text-base font-semibold text-white disabled:opacity-40"
          >
            Enter
          </button>
          {error && <p className="text-center text-sm text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
