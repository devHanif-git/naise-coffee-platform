# iOS PWA Install UX — Design

**Date:** 2026-07-22
**Status:** Approved

## Problem

iOS users can't install the app, even after being given instructions. Two
distinct failure modes are conflated by the current
`components/install-prompt.tsx`:

1. **In-app webview (WhatsApp / Instagram / Chrome iOS / Firefox iOS):**
   Add to Home Screen is *impossible* here. But the current `isIosSafari()`
   check treats any iOS UA containing "Safari" as real Safari — and these
   webviews carry "Safari" in their UA — so it hands them A2HS instructions
   that cannot be followed. This is the "I gave instructions and they still
   couldn't do it" case.
2. **Real Safari, just confused:** the user *can* A2HS but can't find the
   Share button or follow the single cramped instruction line.

Android is unaffected (native `beforeinstallprompt` install works today).

## Root-cause fix: detection

The reliable discriminator is **not** the user-agent — it's
`navigator.standalone`:

- Real Mobile Safari **defines** it (`false` when not installed).
- WKWebview-based in-app browsers (WhatsApp, Instagram, Chrome/Firefox iOS)
  leave it **`undefined`**.

Detection becomes a pure function of `(userAgent, navigator.standalone)`:

```
detectInstallEnv(ua, standalone):
  not iOS                          -> null       (no iOS prompt path)
  standalone === true              -> null       (already installed; existing isInstalled guard)
  iOS && standalone === false      -> "safari"   (real Safari, can A2HS)
  iOS && standalone === undefined  -> "recover"  (webview/other — must reach Safari first)
```

iOS itself is still detected by UA (`/iphone|ipad|ipod/i`). Chrome/Firefox iOS
fold into `"recover"` automatically — correct, since they can't A2HS either.

## Content states (within the existing modal)

The current centered modal, header, and styling are kept. Only the body
branches on state:

1. **Android/Chromium** (`deferredPrompt !== null`) — **unchanged**. Install
   button triggers the native prompt.
2. **iOS `safari`** — pitch copy → "Show me how" expands to clear **numbered**
   steps using the real iOS Share glyph and the Add-to-Home-Screen glyph. This
   replaces today's single cramped instruction line.
3. **iOS `recover`** — "Let's open this in Safari first" → **Open in Safari**
   button.

## Recovery mechanics

iOS provides **no success/failure signal** for the `x-safari-https://`
redirect. So there is no timeout-based detection. On tapping **Open in
Safari**, within one handler:

1. Reveal the fallback UI: a **Copy Link** button plus a short line
   ("tap ⋯ / the compass icon → Open in Safari").
2. Fire `window.location.href = "x-safari-https://" + host + pathname`.

If the redirect works, the page backgrounds and the user is gone — they never
dwell on the fallback. If it silently fails, the fallback is already visible.
No fragile timers.

**Copy Link:** `navigator.clipboard.writeText(location.href)` with a transient
"Copied" state on the button.

**App-name copy:** best-effort only. UA reliably exposes `Instagram` / `FBAN`,
but **not** WhatsApp. Copy stays generic ("this app").
`ponytail: generic app name; add per-app naming when UA tokens are confirmed.`

## Component changes

Single file: `components/install-prompt.tsx`.

- Extract `detectInstallEnv(ua, standalone)` as a pure, exported function.
- Replace `isIosSafari()` usage with the three-state `iosMode` derived from it.
- Keep `isInstalled()`, the `beforeinstallprompt`/`appinstalled` effects, the
  session-scoped dismissal, body-scroll-lock, and Esc-to-dismiss as-is.
- Add local state: `iosStep` (safari expanded), `recovering` (fallback shown),
  `copied`.

The show-gate is unchanged in spirit: logged-in, not installed, not dismissed,
and actionable (`deferredPrompt !== null || iosMode !== null`).

## Verification

- `detectInstallEnv` is pure and gets one `install-prompt.check.mjs`
  self-check (mirrors the existing `hooks/use-body-scroll-lock.check.mjs`
  pattern — plain `node --test` / assert, no framework), asserting:
  - real Safari not installed → `"safari"`
  - WhatsApp/IG webview UA + `standalone === undefined` → `"recover"`
  - Chrome iOS (`CriOS`) → `"recover"`
  - non-iOS → `null`
  - `standalone === true` → `null`
- `npm run build` (EXIT 0).
- Manual: real iOS Safari → numbered steps; WhatsApp in-app → Open in Safari
  fires, fallback present; Android → unchanged native install.

## Out of scope

- iPadOS-reporting-as-Mac. `ponytail: skipped iPad-as-desktop detection; add
  via navigator.maxTouchPoints > 1 when iPad installs matter.`
- No `/install` landing page.
- No new dependencies, no manifest changes, no push notifications.
- Android behavior untouched.
