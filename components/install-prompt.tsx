"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
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

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Non-fatal; still hide for this render.
    }
    setDismissed(true);
  };

  const install = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      // Whether accepted or dismissed, retire the toast for this session.
      setDeferredPrompt(null);
      dismiss();
      return;
    }
    if (isIos) {
      setIosExpanded(true);
    }
  };

  // Gate: logged-in, not installed, not dismissed, and a platform we can act on.
  const canAct = deferredPrompt !== null || isIos;
  if (!hydrated || !isAuthenticated || installed || dismissed || !canAct) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-label="Install Naise Coffee"
      className="fixed left-1/2 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-[70] flex w-[calc(100%-2.5rem)] max-w-[calc(28rem-2.5rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-black px-4 py-3 text-left text-xs font-medium text-white shadow-lg naise-rise"
    >
      {iosExpanded ? (
        <span className="flex flex-1 items-center gap-1.5">
          Tap the
          <Share className="inline size-3.5" aria-hidden />
          Share icon, then &ldquo;Add to Home Screen&rdquo;.
        </span>
      ) : (
        <>
          <span className="flex-1">Install Naise for faster ordering.</span>
          <button
            type="button"
            onClick={install}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black outline-none focus-visible:ring-3 focus-visible:ring-white/30"
          >
            <Download className="size-3.5" aria-hidden />
            Install
          </button>
        </>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-white/70 outline-none hover:text-white focus-visible:ring-3 focus-visible:ring-white/30"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
