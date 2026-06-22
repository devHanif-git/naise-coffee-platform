"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STORE_ACCOUNT_EMAIL } from "@/constants/store";

// Discreet staff escape hatch for the kiosk: press-and-hold the top-right
// corner for ~1.2s to open the exit prompt, then enter the store passcode to
// sign the tablet out. Invisible so a customer never trips it, and gated by the
// passcode so they can't sign it out even if they find it.
export function StoreExit() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function start() {
    timer.current = setTimeout(() => setOpen(true), 1200);
  }
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
  }

  function close() {
    setOpen(false);
    setPasscode("");
    setError(null);
  }

  async function exit() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    // Verify the passcode by re-authenticating the store account; harmless when
    // correct (same session), and the only way to confirm the code client-side.
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: STORE_ACCOUNT_EMAIL,
      password: passcode,
    });
    if (authErr) {
      setError("Incorrect passcode.");
      setPending(false);
      return;
    }
    await supabase.auth.signOut();
    router.push("/store/login");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        aria-label="Exit store mode (press and hold)"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => e.preventDefault()}
        className="fixed right-0 top-0 z-50 size-12 opacity-0"
      />
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
          <div className="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-5 text-center">
            <h2 className="font-heading text-base font-semibold">Exit store mode?</h2>
            <p className="text-xs text-muted-foreground">
              Enter the store passcode to sign this tablet out of the kiosk.
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && passcode.length >= 6 && exit()}
              placeholder="Store passcode"
              aria-label="Store passcode"
              className="h-12 rounded-xl border border-border bg-white px-4 text-center text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="h-11 flex-1 rounded-xl border border-border text-sm font-semibold disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={exit}
                disabled={pending || passcode.length < 6}
                className="h-11 flex-1 rounded-xl bg-black text-sm font-semibold text-white disabled:opacity-40"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
