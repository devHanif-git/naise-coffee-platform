"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { images } from "@/constants/images";
import Image from "next/image";
import { useAuth } from "@/store/auth";

// Session-scoped dismissal flag. Cleared automatically when the tab/session
// ends, so the prompt returns on the next visit (per design: reappear each
// fresh session for logged-in users).
const DISMISS_KEY = "naise-install-dismissed";

// The `beforeinstallprompt` event isn't in the DOM lib types. Minimal shape we
// rely on — no `any`.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// True when the app is running as an installed PWA (Android/desktop standalone
// display-mode, or iOS home-screen where Safari sets navigator.standalone).
function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
    true;
  return standalone || iosStandalone;
}

// iOS Safari has no install API, so we detect it by user-agent to show manual
// "Add to Home Screen" instructions. Excludes Chrome/Firefox on iOS (CriOS/FxiOS)
// which can't add to home screen the same way.
function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/crios|fxios/i.test(ua);
  return isIos && isSafari;
}

export default function InstallPrompt() {
  const { hydrated, isAuthenticated } = useAuth();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  // Lazy initialisers run on the client after hydration — safe for window APIs.
  const [isIos] = useState(isIosSafari);
  const [iosExpanded, setIosExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [installed, setInstalled] = useState(isInstalled);

  useEffect(() => {
    // Capture Android/Chromium's install event so we can trigger it from our
    // own button. preventDefault stops the browser's mini-infobar.
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    // If the user installs (via our button or the browser UI), hide immediately.
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Gate: logged-in, not installed, not dismissed, and a platform we can act on.
  const canAct = deferredPrompt !== null || isIos;
  const open = hydrated && isAuthenticated && !installed && !dismissed && canAct;

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Non-fatal; still hide for this render.
    }
    setDismissed(true);
  }, []);

  // Lock body scroll and wire Esc-to-dismiss while the modal is open. Kept in an
  // effect (not inline) so cleanup restores scroll on unmount/close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, dismiss]);

  const install = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      // Whether accepted or dismissed, retire the prompt for this session.
      setDeferredPrompt(null);
      dismiss();
      return;
    }
    if (isIos) {
      setIosExpanded(true);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-title"
      onClick={dismiss}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white naise-pop"
      >
        <div className="relative flex flex-col items-center overflow-hidden bg-black px-6 pb-8 pt-9 text-center text-white">
          <div className="relative size-24 naise-pop">
            <Image
              src={images.logo}
              alt="Naise Coffee"
              fill
              sizes="96px"
              className="object-contain"
            />
          </div>
          <p className="mt-3 text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-white/60">
            Add to home screen
          </p>
          <h2
            id="install-title"
            className="mt-2 font-heading text-3xl font-bold leading-none tracking-tight"
          >
            Install Naise
          </h2>
        </div>

        <div className="px-6 py-6">
          {iosExpanded ? (
            <p className="flex flex-wrap items-center justify-center gap-1.5 text-center text-sm leading-relaxed text-muted-foreground">
              Tap the
              <Share className="inline size-4 text-foreground" aria-hidden />
              Share icon, then &ldquo;Add to Home Screen&rdquo;.
            </p>
          ) : (
            <p className="text-center text-sm leading-relaxed text-muted-foreground">
              Install Naise for faster ordering, quick access from your home
              screen, and a smoother checkout.
            </p>
          )}

          {!iosExpanded && (
            <button
              type="button"
              onClick={install}
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Download className="size-4" aria-hidden />
              Install
            </button>
          )}

          <button
            type="button"
            onClick={dismiss}
            className="mt-3 h-11 w-full rounded-full text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {iosExpanded ? "Got it" : "Not now"}
          </button>
        </div>
      </div>
    </div>
  );
}
