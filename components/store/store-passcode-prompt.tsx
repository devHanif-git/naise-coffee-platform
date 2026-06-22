// components/store/store-passcode-prompt.tsx
"use client";

import { useState, useTransition } from "react";
import { enterStoreMode } from "@/app/(store)/store/actions";

// Shared passcode entry for unlocking store mode. Used full-screen on
// /store/login and inside the hidden enter-gesture modal. enterStoreMode sets a
// signed cookie server-side WITHOUT touching the user's session.
export function StorePasscodePrompt({
  disabled,
  onCancel,
  onSuccess,
}: {
  disabled?: boolean;
  onCancel?: () => void;
  onSuccess: () => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await enterStoreMode(passcode);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSuccess();
    });
  }

  if (disabled) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Store ordering is currently off. Ask a manager.
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && passcode.length >= 6 && submit()}
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
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="h-12 rounded-2xl border border-border text-sm font-semibold disabled:opacity-40"
        >
          Cancel
        </button>
      )}
      {error && <p className="text-center text-sm text-rose-600">{error}</p>}
    </div>
  );
}
