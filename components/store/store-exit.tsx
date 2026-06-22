"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { exitStoreMode } from "@/app/(store)/store/actions";

// Discreet staff escape hatch for the kiosk: press-and-hold the top-right corner
// for ~1.2s to open the exit prompt, then enter the store passcode to drop store
// mode. Clearing the naise_store cookie returns the device to whatever session
// it already had (staff/admin) or to guest — it NEVER signs anyone out.
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
    const res = await exitStoreMode(passcode);
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    router.push("/");
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
              Enter the store passcode to leave the kiosk on this device.
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
