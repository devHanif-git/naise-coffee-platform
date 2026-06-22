"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Discreet staff escape hatch for the kiosk: press-and-hold the top-right
// corner for ~1.2s to open a confirm, then sign the tablet out. Invisible so a
// customer never trips it; staff know where it is.
export function StoreExit() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function start() {
    timer.current = setTimeout(() => setOpen(true), 1200);
  }
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
  }

  async function exit() {
    setPending(true);
    await createClient().auth.signOut();
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
              This signs the tablet out of the kiosk. You&apos;ll need the passcode to get
              back in.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="h-11 flex-1 rounded-xl border border-border text-sm font-semibold disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={exit}
                disabled={pending}
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
