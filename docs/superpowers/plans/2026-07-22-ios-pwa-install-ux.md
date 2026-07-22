# iOS PWA Install UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix iOS PWA install UX so in-app-webview users get routed into Safari and real-Safari users get clear step-by-step Add-to-Home-Screen guidance.

**Architecture:** Replace the naive `isIosSafari()` UA check in the single `components/install-prompt.tsx` modal with a pure `detectInstallEnv(ua, standalone)` function that uses `navigator.standalone` (defined in real Safari, `undefined` in WKWebViews) to return `"safari"` | `"recover"` | `null`. The modal body branches on that: Android keeps its native install, `"safari"` shows numbered A2HS steps, `"recover"` fires an `x-safari-https://` redirect with an always-visible copy-link fallback.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind, lucide-react. No new dependencies.

## Global Constraints

- No new dependencies, no manifest changes, no push notifications (from spec).
- Android install behavior must stay untouched.
- App-name copy stays generic ("this app") — WhatsApp is not detectable via UA.
- Verification gate: `npm run build` (EXIT 0). Lint scoped: `npx eslint <path>`. No JS test framework exists — self-checks are standalone `.mjs` assertion scripts run with `node`, printing `ok` (see `hooks/use-body-scroll-lock.check.mjs`).
- Money/format rules and other project constraints unaffected by this change.

---

### Task 1: Pure `detectInstallEnv` + framework-free self-check

Additive only — this task adds the exported pure function and its self-check without removing `isIosSafari` yet, so the component still compiles and the build stays green. Task 2 does the swap.

**Files:**
- Modify: `components/install-prompt.tsx` (add exported `detectInstallEnv` near the top, after the `BeforeInstallPromptEvent` type)
- Create: `components/install-prompt.check.mjs`

**Interfaces:**
- Produces: `export function detectInstallEnv(ua: string, standalone: boolean | undefined): "safari" | "recover" | null` — consumed by Task 2's `detectIos()` wrapper.

- [ ] **Step 1: Add the exported pure function**

In `components/install-prompt.tsx`, insert immediately after the `BeforeInstallPromptEvent` type definition (currently ends at line 20):

```ts
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
```

Leave `isIosSafari` and everything else unchanged for now.

- [ ] **Step 2: Create the self-check**

Create `components/install-prompt.check.mjs`:

```js
// Framework-free regression check for iOS install-environment detection.
// Run: node components/install-prompt.check.mjs
// Guards the root fix: WhatsApp/Instagram/Chrome-iOS in-app browsers carry
// "Safari"/iOS tokens in their UA but leave navigator.standalone undefined, so
// they MUST map to "recover" (Add to Home Screen impossible there), not "safari".
// Mirror of detectInstallEnv in components/install-prompt.tsx — keep in sync
// (node cannot import the .tsx directly, matching the repo's .check.mjs pattern).
import assert from "node:assert";

function detectInstallEnv(ua, standalone) {
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) return null;
  if (standalone === true) return null;
  return standalone === false ? "safari" : "recover";
}

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const WHATSAPP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

// Real Safari, not installed → can Add to Home Screen.
assert.strictEqual(detectInstallEnv(IPHONE_SAFARI, false), "safari", "real Safari → safari");
// In-app WKWebViews leave standalone undefined → must recover, NOT safari.
assert.strictEqual(detectInstallEnv(WHATSAPP, undefined), "recover", "WhatsApp webview → recover");
assert.strictEqual(detectInstallEnv(INSTAGRAM, undefined), "recover", "Instagram webview → recover");
assert.strictEqual(detectInstallEnv(CHROME_IOS, undefined), "recover", "Chrome iOS → recover");
// Already installed (standalone true) → no prompt.
assert.strictEqual(detectInstallEnv(IPHONE_SAFARI, true), null, "installed → null");
// Non-iOS → no iOS path (Android handled by beforeinstallprompt elsewhere).
assert.strictEqual(detectInstallEnv(ANDROID, undefined), null, "android → null");

console.log("ok");
```

- [ ] **Step 3: Run the self-check — expect pass**

Run: `node components/install-prompt.check.mjs`
Expected: prints `ok`, exit 0.

- [ ] **Step 4: Confirm the check actually bites**

Temporarily change the WhatsApp assertion's expected value from `"recover"` to `"safari"`, re-run `node components/install-prompt.check.mjs`, and confirm it now FAILS with an `AssertionError` ("WhatsApp webview → recover"). Then revert that one character back to `"recover"` and re-run → `ok`. This proves the assertion guards the root bug rather than passing vacuously.

- [ ] **Step 5: Verify build still green**

Run: `npm run build`
Expected: EXIT 0 (the new exported function is unused-but-exported, which ESLint does not flag; `isIosSafari` is still in use).

- [ ] **Step 6: Commit**

```bash
git add components/install-prompt.tsx components/install-prompt.check.mjs
git commit -m "feat(ios): pure detectInstallEnv for install env + self-check"
```

---

### Task 2: Rewire the modal to three iOS states + Safari recovery

Swaps `isIosSafari` for `detectInstallEnv`, adds the `"safari"` numbered-steps and `"recover"` open-in-Safari flows, and removes the dead `isIosSafari` helper. Deliverable: working modal, green build.

**Files:**
- Modify: `components/install-prompt.tsx`

**Interfaces:**
- Consumes: `detectInstallEnv(ua, standalone)` from Task 1.

- [ ] **Step 1: Remove `isIosSafari`, add the `detectIos` wrapper**

Delete the entire `isIosSafari()` function (currently lines ~33-42, the block with the comment "iOS Safari has no install API..."). In its place add:

```ts
// Client-only wrapper around the pure detector, reading the live navigator.
function detectIos(): "safari" | "recover" | null {
  if (typeof window === "undefined") return null;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return detectInstallEnv(nav.userAgent, nav.standalone);
}
```

- [ ] **Step 2: Update imports and component state**

Change the lucide import line to:

```ts
import { Check, Copy, Download, ExternalLink, Plus, Share } from "lucide-react";
```

Replace the state block. Remove:

```ts
const [isIos] = useState(isIosSafari);
const [iosExpanded, setIosExpanded] = useState(false);
```

Add in their place:

```ts
const [iosMode] = useState(detectIos);
const [iosStep, setIosStep] = useState(false); // safari: numbered steps shown
const [recovering, setRecovering] = useState(false); // recover: fallback shown
const [copied, setCopied] = useState(false);
```

- [ ] **Step 3: Update the actionable gate and the `install` handler**

Change the `canAct` line from `deferredPrompt !== null || isIos` to:

```ts
const canAct = deferredPrompt !== null || iosMode !== null;
```

Replace the `install` function body's iOS branch. The full handler becomes:

```ts
const install = async () => {
  if (deferredPrompt) {
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
    return;
  }
  if (iosMode === "safari") setIosStep(true);
};
```

Add the two new handlers right after `install`:

```ts
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
```

- [ ] **Step 4: Replace the modal body**

Replace the entire inner content `<div className="px-6 py-6">...</div>` (currently lines ~155-187, from `{iosExpanded ? (` through the closing dismiss button) with:

```tsx
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
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black text-[0.625rem] font-bold text-white">1</span>
          <span className="flex flex-wrap items-center gap-1">
            Tap the <Share className="inline size-4 text-foreground" aria-hidden /> Share button in Safari.
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black text-[0.625rem] font-bold text-white">2</span>
          <span className="flex flex-wrap items-center gap-1">
            Choose <Plus className="inline size-4 text-foreground" aria-hidden /> &ldquo;Add to Home Screen&rdquo;.
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black text-[0.625rem] font-bold text-white">3</span>
          <span>Tap &ldquo;Add&rdquo; — Naise lands on your home screen.</span>
        </li>
      </ol>
    ) : (
      <>
        <p className="text-center text-sm leading-relaxed text-muted-foreground">
          Install Naise for faster ordering and one-tap access from your home
          screen.
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
        Still here? In this app, tap the <span className="font-semibold text-foreground">&hellip;</span> or compass icon and choose &ldquo;Open in Safari&rdquo; — or copy the link and paste it into Safari.
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
```

- [ ] **Step 5: Lint the changed file**

Run: `npx eslint components/install-prompt.tsx`
Expected: no errors (no unused `isIosSafari`, no unused imports).

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 7: Re-run the detection self-check (guard against drift)**

Run: `node components/install-prompt.check.mjs`
Expected: `ok`.

- [ ] **Step 8: Manual verification (best-effort, iOS-only)**

Cannot be automated (real iOS devices needed). Where a device is available, confirm:
- Real iPhone Safari, signed in, not installed → "Show me how" expands to the three numbered steps.
- Open the site link inside WhatsApp/Instagram, signed in → modal shows "Open in Safari"; tapping it attempts the redirect and reveals the Copy link fallback.
- Android Chrome, signed in → unchanged native install still fires.

If no device is available, state that explicitly rather than claiming the manual paths were verified.

- [ ] **Step 9: Commit**

```bash
git add components/install-prompt.tsx
git commit -m "feat(ios): route webview users to Safari, add A2HS steps"
```

---

## Self-Review

**Spec coverage:**
- Root-cause detection via `navigator.standalone` → Task 1 (`detectInstallEnv`) + Task 2 (`detectIos`). ✓
- Three content states (Android / ios-safari / ios-recover) → Task 2 Step 4. ✓
- Recovery mechanics (reveal fallback + fire `x-safari-https://` in one tap, no timers) → Task 2 Step 3 `openInSafari`. ✓
- Copy Link with "Copied" state via `navigator.clipboard` → Task 2 Step 3 `copyLink` + Step 4 button. ✓
- Generic app-name copy (WhatsApp not UA-detectable) → recover copy says "this app". ✓
- Self-check mirroring the pattern → Task 1 Steps 2-4. ✓
- Unchanged: dismissal/session, scroll-lock, Esc, `beforeinstallprompt`/`appinstalled`, header → preserved (not touched by any step). ✓
- Out of scope honored: no iPad-as-Mac handling, no `/install` page, no deps/manifest/push. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `detectInstallEnv` return `"safari" | "recover" | null` used identically by `detectIos` and the `iosMode` state; `iosMode === "safari"` and the `recovering`/`iosStep` booleans line up across Steps 2-4.
