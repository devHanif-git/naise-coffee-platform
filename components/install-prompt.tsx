"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, Plus, Share } from "lucide-react";
import { images } from "@/constants/images";
import Image from "next/image";
import { useAuth } from "@/store/auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

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

// Pure iOS install-environment detection. Exported and kept pure so the
// framework-free self-check (install-prompt.check.mjs) can exercise every
// branch. Returns null for non-iOS and already-installed cases.
export function detectInstallEnv(
  ua: string,
  standalone: boolean | undefined,
): "safari" | "recover" | null {
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) return null;
  if (standalone === true) return null;
  // Real Mobile Safari DEFINES navigator.standalone (false when not installed).
  // WKWebView in-app browsers (WhatsApp, Instagram, Chrome/Firefox iOS) leave
  // it undefined and cannot Add to Home Screen — route them to recovery.
  return standalone === false ? "safari" : "recover";
}

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

// Client-only wrapper around the pure detector, reading the live navigator.
function detectIos(): "safari" | "recover" | null {
  if (typeof window === "undefined") return null;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return detectInstallEnv(nav.userAgent, nav.standalone);
}

export default function InstallPrompt() {
  const { hydrated, isAuthenticated } = useAuth();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  // Lazy initialisers run on the client after hydration — safe for window APIs.
  const [iosMode] = useState(detectIos);
  const [iosStep, setIosStep] = useState(false); // safari: numbered steps shown
  const [recovering, setRecovering] = useState(false); // recover: fallback shown
  const [copied, setCopied] = useState(false);
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
  const canAct = deferredPrompt !== null || iosMode !== null;
  const open = hydrated && isAuthenticated && !installed && !dismissed && canAct;

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Non-fatal; still hide for this render.
    }
    setDismissed(true);
  }, []);

  // Wire Esc-to-dismiss while open. Body scroll is locked via the shared
  // refcounted hook so it composes when Welcome + Install stack after login.
  useBodyScrollLock(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
    if (iosMode === "safari") setIosStep(true);
  };

  const openInSafari = () => {
    // Reveal the fallback in the SAME tap: if the redirect works the page
    // backgrounds and the user never sees it; if it silently fails (iOS gives no
    // success/failure signal either way) the fallback is already here.
    setRecovering(true);
    const { host, pathname, search } = window.location;
    window.location.href = `x-safari-https://${host}${pathname}${search}`;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      // Clipboard can reject (permissions/insecure context); leave button as-is.
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
          {deferredPrompt ? (
            <>
              <p className="text-center text-sm leading-relaxed text-muted-foreground">
                Install Naise for faster ordering, quick access from your home
                screen, and a smoother checkout.
              </p>
              <button
                type="button"
                onClick={install}
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Download className="size-4" aria-hidden />
                Install
              </button>
            </>
          ) : iosMode === "safari" ? (
            iosStep ? (
              <ol className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                <li className="flex items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black text-[0.625rem] font-bold text-white">
                    1
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    Tap the{" "}
                    <Share className="inline size-4 text-foreground" aria-hidden />{" "}
                    Share button in Safari.
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black text-[0.625rem] font-bold text-white">
                    2
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    Choose{" "}
                    <Plus className="inline size-4 text-foreground" aria-hidden />{" "}
                    &ldquo;Add to Home Screen&rdquo;.
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black text-[0.625rem] font-bold text-white">
                    3
                  </span>
                  <span>Tap &ldquo;Add&rdquo; — Naise lands on your home screen.</span>
                </li>
              </ol>
            ) : (
              <>
                <p className="text-center text-sm leading-relaxed text-muted-foreground">
                  Install Naise for faster ordering and one-tap access from your
                  home screen.
                </p>
                <button
                  type="button"
                  onClick={install}
                  className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Share className="size-4" aria-hidden />
                  Show me how
                </button>
              </>
            )
          ) : recovering ? (
            <>
              <p className="text-center text-sm leading-relaxed text-muted-foreground">
                Still here? In this app, tap the{" "}
                <span className="font-semibold text-foreground">&hellip;</span> or
                compass icon and choose &ldquo;Open in Safari&rdquo; — or copy the
                link and paste it into Safari.
              </p>
              <button
                type="button"
                onClick={copyLink}
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {copied ? (
                  <>
                    <Check className="size-4" aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-4" aria-hidden />
                    Copy link
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <p className="text-center text-sm leading-relaxed text-muted-foreground">
                To install Naise, open it in Safari first.
              </p>
              <button
                type="button"
                onClick={openInSafari}
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ExternalLink className="size-4" aria-hidden />
                Open in Safari
              </button>
            </>
          )}

          <button
            type="button"
            onClick={dismiss}
            className="mt-3 h-11 w-full rounded-full text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {iosStep || recovering ? "Got it" : "Not now"}
          </button>
        </div>
      </div>
    </div>
  );
}
