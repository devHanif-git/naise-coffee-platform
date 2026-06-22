// components/store/store-login-screen.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { StorePasscodePrompt } from "@/components/store/store-passcode-prompt";

// Full-screen unlock prompt shown on direct navigation to /store/login (and any
// /store/* the kiosk layout redirects here when not in store mode). Cancel/Back
// returns to the app WITHOUT signing anyone out — the user keeps their session.
export function StoreLoginScreen({ disabled }: { disabled: boolean }) {
  const router = useRouter();

  function backToApp() {
    router.push("/");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8">
      <button
        type="button"
        onClick={backToApp}
        className="absolute left-5 top-5 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to app
      </button>
      <h1 className="font-heading text-2xl font-bold uppercase tracking-[0.2em]">
        Naise Store
      </h1>
      <StorePasscodePrompt
        disabled={disabled}
        onSuccess={() => {
          router.push("/store");
          router.refresh();
        }}
      />
    </div>
  );
}
