# PWA Readiness: Service Worker + Icons

**Date:** 2026-06-28
**Status:** Proposed

## Problem

The app is only *partially* PWA-ready. `app/manifest.ts` exists with valid
metadata, but two things block a real installable PWA:

1. **No service worker.** No `next-pwa`, no `workbox`, no
   `navigator.serviceWorker.register(...)`. Without one there is no offline
   shell, no caching, and Chromium-based browsers will not fire the install
   prompt. A manifest alone does not make an installable PWA.
2. **Placeholder icons.** Both the 192 and 512 manifest entries point at the
   same file (`/brand/logo_transparent.png`, a 640×640 RGBA PNG). There is no
   maskable icon and no `apple-touch-icon`. The code itself flags this with a
   `TODO`.

AGENTS.md explicitly scopes this work: "scaffold the manifest/service worker so
they can be added later, but do not build push now." This delivers the service
worker + icons; push notifications stay out of scope.

## Decisions (approved)

- **Service worker library:** Serwist (`@serwist/next`). `next-pwa` is
  effectively abandoned and has no Next 16 support. Serwist is its actively
  maintained successor; peer deps allow Next ≥14 and it is dev-tested against
  Next 16.2.
- **Caching scope:** Conservative. Precache the build/app shell + static
  assets. Network-first navigation so the catalog stays fresh. Never cache
  authenticated data, orders, cart, or Supabase API calls. This matches
  AGENTS.md ("Do not aggressively cache authenticated or order data").
- **Icons:** Generate from the existing logo using `sharp` (already installed),
  producing real 192, 512, 512-maskable, and apple-touch PNGs.

## Approach

### 1. Dependencies

```
npm i @serwist/next && npm i -D serwist
```

`@serwist/next` is a runtime dependency (imported by `next.config.ts`);
`serwist` is the dev/build dependency (the SW toolkit). No other new libraries.

### 2. Service worker config (`next.config.ts`)

Wrap the existing config with `withSerwistInit`. The repo uses `next.config.ts`
(TypeScript) and `output: "standalone"` — both compatible.

```ts
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development", // avoid SW churn in dev
});

// ... existing nextConfig unchanged ...

export default withSerwist(nextConfig);
```

`disable` in development is deliberate: a live service worker fighting Next's
dev HMR causes stale-asset confusion. The SW is exercised via
`next build && next start`.

### 3. Service worker source (`app/sw.ts`)

Minimal Serwist worker using the Next default runtime caching, which is already
tuned to be conservative (network-first for pages, cache-first only for
immutable build assets, and it does not cache cross-origin Supabase calls):

```ts
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
```

Registration is automatic — `@serwist/next` injects it; no client-side
`register()` code needed.

### 4. TypeScript types (scoped, not global)

Serwist's docs suggest adding `"lib": ["webworker"]` and
`"types": ["@serwist/next/typings"]` to the root `tsconfig.json`. **We will not
do that** — adding the `webworker` lib globally conflicts with the DOM lib used
across the whole app (e.g. `self`, `caches`, `clients` get the wrong types in
React components).

Instead, isolate worker typing:
- The `declare const self: ServiceWorkerGlobalScope` in `app/sw.ts` gives the
  worker file what it needs locally.
- Add a dedicated `app/sw.tsconfig`-style scoping only if the build complains.
  First attempt: rely on the in-file declarations + `skipLibCheck: true`
  (already set). If `next build` surfaces type errors for `app/sw.ts`, add a
  triple-slash `/// <reference lib="webworker" />` at the top of `app/sw.ts`
  (file-scoped, does not leak to the rest of the app).
- Add `public/sw.js` (and `public/swe-worker*`) to `.gitignore` and to
  tsconfig `exclude` so the generated SW is neither linted nor committed.

### 5. Icons

Add a one-off generation script `scripts/generate-pwa-icons.mjs` using `sharp`
(already a transitive dep via Next; confirmed importable). Source:
`public/brand/logo_transparent.png` (640×640 RGBA).

Outputs to `public/icons/`:
- `icon-192.png` — 192×192, transparent, logo fit with small padding.
- `icon-512.png` — 512×512, transparent.
- `icon-maskable-512.png` — 512×512, logo centered on a solid brand background
  (`#171717`, the existing `theme_color`) within the maskable safe zone (logo
  scaled to ~80% so it survives platform masking/cropping).
- `apple-touch-icon.png` — 180×180, logo on solid background (iOS does not
  honor transparency well for home-screen icons).

The script is committed and runnable (`node scripts/generate-pwa-icons.mjs`),
and the generated PNGs are committed to `public/icons/` so the build/runtime
does not depend on regeneration.

### 6. Manifest update (`app/manifest.ts`)

Point at the new icons and add maskable purpose:

```ts
icons: [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
],
```

Removes the existing `TODO`.

### 7. iOS metadata (`app/layout.tsx`)

Add `appleWebApp` config and the apple-touch-icon link to the root `metadata`,
plus a `viewport`/`themeColor` export so iOS "Add to Home Screen" renders well:

```ts
export const metadata: Metadata = {
  // ...existing...
  appleWebApp: { capable: true, title: "Naise", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
```

Next auto-emits the `<link rel="manifest">` from `app/manifest.ts`; we verify it
renders rather than hand-adding it.

## Out of scope

- Push notifications (per AGENTS.md).
- Offline caching of catalog/menu data (chose Conservative, not "catalog
  offline").
- Custom offline fallback page (can be added later via
  `additionalPrecacheEntries`).

## Verification

1. `npm run build` succeeds with no type errors (esp. `app/sw.ts`).
2. `public/sw.js` is generated and git-ignored.
3. `next start`, then in Chrome DevTools → Application:
   - Manifest panel shows name, icons (incl. maskable), theme color, no errors.
   - Service Workers panel shows an activated worker.
   - "Installability" shows the app is installable.
4. Lighthouse PWA category: installable + has-service-worker pass.
5. Confirm Supabase API calls and authenticated pages are **not** served from
   cache (Network tab, offline toggle behaves correctly: shell loads, live data
   fails gracefully rather than showing stale orders).

## Files touched

- `package.json` — add `@serwist/next`, `serwist`.
- `next.config.ts` — wrap with `withSerwistInit`.
- `app/sw.ts` — new service worker source.
- `app/manifest.ts` — real icons + maskable.
- `app/layout.tsx` — iOS metadata.
- `scripts/generate-pwa-icons.mjs` — new icon generator.
- `public/icons/*` — generated icons (committed).
- `.gitignore`, `tsconfig.json` — exclude generated SW.
