# PWA Install Prompt Toast — Design

**Date:** 2026-07-10
**Status:** Approved

## Goal

Encourage logged-in customers to install the app to their phone (iOS and
Android) with a persistent, non-annoying bottom toast. The toast has an explicit
**Install** button and an **X** to dismiss. Dismissal hides it for the current
session only; it reappears on the next fresh session. Guests never see it, and
users already running the installed app never see it.

## Behavior Summary

- **Audience:** logged-in users only. Guests see nothing.
- **Already installed:** never shown (standalone display-mode / iOS
  `navigator.standalone`).
- **Position:** bottom of screen, above the tab bar, centered within the
  `max-w-md` customer column. Persistent — no auto-timeout.
- **Dismiss (X):** remembered in `sessionStorage` — hidden until a new session
  (tab reopen / next visit). Not persisted across sessions.
- **Install button:**
  - Android/Chromium → triggers the native install dialog via the captured
    `beforeinstallprompt` event; toast hides once the dialog resolves.
  - iOS Safari → expands the toast in place into a short instruction: "Tap the
    Share icon, then *Add to Home Screen*". No native install API exists on iOS.
- **No library, no DB, no manifest changes.** The manifest already provides
  everything needed for installability.

## Component

New client component: `components/install-prompt.tsx`.

Rendered once as a sibling in `app/(customer)/layout.tsx`, next to
`<WelcomeModal />` (established pattern for global client-only UI). Renders
`null` unless all show-conditions pass, so it is inert on pages where it should
not appear.

### Show conditions (all must be true)

1. `hydrated && isAuthenticated` from `useAuth()` — logged-in users only.
2. Not already installed:
   - `window.matchMedia("(display-mode: standalone)").matches` is `false`, AND
   - `(navigator as ...).standalone !== true` (iOS Safari home-screen check).
3. Not dismissed this session — no `naise-install-dismissed` flag in
   `sessionStorage`.
4. Platform is actionable:
   - **Android/Chromium:** a `beforeinstallprompt` event was captured. If it
     never fires (unsupported browser, or already installed), the toast never
     shows — a natural extra guard.
   - **iOS Safari:** detected via user-agent (iOS device + Safari engine + not
     already standalone). User-agent sniffing is the only option on iOS because
     no install event exists.

### Internal state

- `deferredPrompt`: the captured `BeforeInstallPromptEvent`, or `null`.
- `platform`: `"android" | "ios" | null`.
- `iosExpanded`: whether the iOS instruction line is showing.
- `dismissed`: mirror of the `sessionStorage` flag for the current render.

### Effects

- On mount, add a `beforeinstallprompt` listener that calls
  `e.preventDefault()` and stores the event in `deferredPrompt` (so it can be
  triggered later from the Install button).
- On mount, detect iOS Safari via user-agent and set `platform` accordingly when
  the `beforeinstallprompt` path does not apply.
- Add an `appinstalled` listener that hides the toast immediately if the user
  completes installation.
- Clean up both listeners on unmount.

## UI

Matches the existing `CartToast` styling in `components/cart-screen.tsx`: black
rounded pill, small medium-weight white text, subtle shadow, `naise-rise`
entrance. Differences:

- Positioned at the bottom above the tab bar using
  `bottom-[calc(4rem+env(safe-area-inset-bottom)+<gap>)]` rather than `top-4`.
- Two controls: an **Install** button (platform-appropriate action) and an
  **X** icon button (dismiss). Icons come from `lucide-react`, already used in
  the project (e.g. a download/share glyph and `X`).
- iOS expanded state swaps the body for the "Share → Add to Home Screen"
  instruction with the iOS share glyph; the X still dismisses.

## Out of Scope

- No `getInstalledRelatedApps()` / `related_applications` manifest wiring — the
  standalone check covers the goal (don't nag people already using the app).
- No cross-session backoff or escalation — dismissal is session-scoped only.
- No push notifications.
- No changes to guests' experience.

## Testing

- Manual: signed-in on Android Chrome → toast appears, Install fires native
  dialog, `appinstalled` hides it. X hides for the session, returns on reopen.
- Manual: signed-in on iOS Safari → toast appears, Install expands to the
  Share instruction, X dismisses.
- Guest (signed out) → no toast.
- Running the installed app (standalone) → no toast.
- Type-check and lint pass.
