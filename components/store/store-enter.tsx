// components/store/store-enter.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StorePasscodePrompt } from "@/components/store/store-passcode-prompt";

// Discreet staff entry to the kiosk from the customer app: press-and-hold the
// top-LEFT corner for ~1.2s to open the passcode prompt. Mounted on the menu
// screen only. Top-left keeps it clear of the search bar's clear (X) button,
// which sits top-right; sitting at top-0 mirrors the kiosk EXIT gesture.
// Invisible so a customer never trips it, and passcode-gated either way.
export function StoreEnter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function start() {
    timer.current = setTimeout(() => setOpen(true), 1200);
  }
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Enter store mode (press and hold)"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => e.preventDefault()}
        className="fixed left-0 top-0 z-50 size-12 opacity-0"
      />
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
          <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-white p-5 text-center">
            <h2 className="font-heading text-base font-semibold">Enter store mode?</h2>
            <p className="text-xs text-muted-foreground">
              Enter the store passcode to open the kiosk on this device.
            </p>
            <StorePasscodePrompt
              onCancel={() => setOpen(false)}
              onSuccess={() => {
                router.push("/store");
                router.refresh();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
