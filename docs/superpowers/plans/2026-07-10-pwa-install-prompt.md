# PWA Install Prompt Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show logged-in customers a persistent bottom toast that nudges them to install the PWA on iOS and Android, dismissible per session.

**Architecture:** A single client component (`components/install-prompt.tsx`) rendered as a sibling in the customer layout next to `<WelcomeModal />`. It captures the Android `beforeinstallprompt` event, detects iOS Safari by user-agent, gates on auth + not-installed + not-dismissed-this-session, and renders a black rounded-pill toast (matching the existing `CartToast`) pinned above the tab bar. It renders `null` whenever any condition fails.

**Tech Stack:** Next.js App Router, React client component, TypeScript (strict, no `any`), Tailwind, `lucide-react`, existing `useAuth()` store.

## Global Constraints

- No new libraries — use `lucide-react` (already `^1.18.0`) and existing styling patterns.
- No DB changes, no manifest changes, no service-worker changes.
- TypeScript strict, no `any`.
- Logged-in users only; guests see nothing.
- Never shown when already installed (standalone display-mode / iOS `navigator.standalone`).
- Dismissal is session-scoped via `sessionStorage` key `naise-install-dismissed`; reappears next session.
- Persistent — no auto-timeout.
- Position: bottom, above the tab bar, centered within the `max-w-md` customer column.
- Verification is `npm run lint` and `npm run build` (no test framework in this project) plus manual checks. Do NOT add a test framework.

---

### Task 1: InstallPrompt component

**Files:**
- Create: `components/install-prompt.tsx`
- Reference (read only, do not modify): `components/cart-screen.tsx:306-356` (CartToast styling), `store/auth.tsx:256-260` (`useAuth`), `app/globals.css:158-161` (`naise-rise`).

**Interfaces:**
- Consumes: `useAuth()` from `@/store/auth` → `{ hydrated: boolean; isAuthenticated: boolean }`.
- Produces: default export `InstallPrompt` — a React client component taking no props. Renders `null` or a fixed-position toast.

- [ ] **Step 1: Create the component file**

Create `components/install-prompt.tsx` with the full content below.

```tsx
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
  const [isIos, setIsIos] = useState(false);
  const [iosExpanded, setIosExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we check
  const [installed, setInstalled] = useState(true); // assume installed until we check

  useEffect(() => {
    // Read initial gates on mount (client-only APIs).
    setInstalled(isInstalled());
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
    setIsIos(isIosSafari());

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
```

- [ ] **Step 2: Verify the file type-checks in isolation via lint**

Run: `npm run lint`
Expected: PASS with no errors referencing `components/install-prompt.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/install-prompt.tsx
git commit -m "feat(pwa): add install prompt toast component"
```

---

### Task 2: Mount InstallPrompt in the customer layout

**Files:**
- Modify: `app/(customer)/layout.tsx` (add import + render next to `<WelcomeModal />`)

**Interfaces:**
- Consumes: default export `InstallPrompt` from `@/components/install-prompt` (Task 1).
- Produces: nothing new; wires the component into the live tree.

- [ ] **Step 1: Add the import**

In `app/(customer)/layout.tsx`, add alongside the existing component imports (near the `WelcomeModal` import on line 9):

```tsx
import { WelcomeModal } from "@/components/welcome-modal";
import InstallPrompt from "@/components/install-prompt";
```

- [ ] **Step 2: Render the component**

In the same file, render `<InstallPrompt />` immediately after `<WelcomeModal />` (currently line 39), inside `<CartProvider>` so it sits under `AuthProvider` and can call `useAuth()`:

```tsx
            <WelcomeModal />
            <InstallPrompt />
          </CartProvider>
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS, no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build completes successfully (compiles, no type errors).

- [ ] **Step 5: Manual verification**

Start `npm run dev` and check, in the customer storefront:
- Signed out (guest): no toast appears.
- Signed in, desktop Chrome with an installable manifest: toast appears at the bottom above the tab bar; **Install** opens the native dialog; **X** hides it and it stays hidden until the tab is closed and reopened (new session).
- Signed in, iOS Safari (or device emulation): toast appears; **Install** expands to the "Share → Add to Home Screen" instruction; **X** dismisses.
- Running as an installed/standalone app: no toast.

Note: `beforeinstallprompt` requires a production-like install context; if it doesn't fire in `dev`, verify the Android path against a `npm run build && npm start` served over the deployed HTTPS origin.

- [ ] **Step 6: Commit**

```bash
git add "app/(customer)/layout.tsx"
git commit -m "feat(pwa): mount install prompt in customer layout"
```

---

## Self-Review

**Spec coverage:**
- Logged-in only / guests hidden → gate `!isAuthenticated` (Task 1). ✓
- Already-installed hidden (standalone + iOS `navigator.standalone`) → `isInstalled()` (Task 1). ✓
- Session-scoped dismissal, reappears next session → `sessionStorage` `DISMISS_KEY` (Task 1). ✓
- Bottom, above tab bar, `max-w-md` column, persistent → fixed positioning classes (Task 1). ✓
- Android native install via `beforeinstallprompt` → captured + `prompt()` (Task 1). ✓
- iOS Share instruction on Install → `iosExpanded` branch (Task 1). ✓
- `appinstalled` hides immediately → listener (Task 1). ✓
- Explicit Install + X controls → both buttons (Task 1). ✓
- No library / DB / manifest changes → only component + layout wiring. ✓
- Mounted next to WelcomeModal → Task 2. ✓

**Placeholder scan:** No TBD/TODO; all code shown in full. ✓

**Type consistency:** `BeforeInstallPromptEvent`, `isInstalled()`, `isIosSafari()`, `install()`, `dismiss()`, `DISMISS_KEY` used consistently within Task 1; `InstallPrompt` default export consumed in Task 2. ✓
