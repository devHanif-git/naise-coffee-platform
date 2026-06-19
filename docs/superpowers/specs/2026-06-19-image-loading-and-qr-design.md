# Image Loading & DuitNow QR — Design

**Date:** 2026-06-19
**Status:** Approved (design); pending implementation plan

## Problem

Images on the storefront load slowly, and the DuitNow QR on checkout is the
worst offender — it sometimes takes several seconds to appear and can look
broken/empty while loading. The user wanted a way to make images feel instant
and to show a loading state for the QR instead of an empty space.

## Root Cause

The source image files in `public/brand/` are extremely oversized for web use:

| File | Current size |
|---|---|
| `coffee_with_logo.png` (used for every menu item) | 2.3 MB |
| `QRCode.png` (DuitNow QR on checkout) | 2.0 MB |
| `flash_sales.png` | 1.2 MB |
| `latte_art_black_mug.png` | 778 KB |
| `celebration_in_a_cup.png` | 555 KB |
| `badge.png` | 421 KB |

A 2 MB QR code is the direct reason it "takes time to show." A correctly
encoded QR should be tens of KB. No landing/preload screen can fix this — a
2 MB file is 2 MB regardless of where it is requested; preloading only hides
the cost and shifts the wait to first load. It also does not generalize once
images come from a CMS (an unbounded, changing catalog cannot be preloaded).

## Goals

1. The DuitNow QR appears quickly and never looks broken — show a loading
   state first, then the QR.
2. Menu and rewards images never pop in blank; a placeholder holds their space
   and the image fades in when ready.
3. The fix works identically for **local images today** and **Supabase Storage
   (CMS) images later**, with no rework when the data source changes.

## Non-Goals

- No preloading/gating landing screen. The existing `/` splash stays as-is.
- No CMS image-upload compression in this task (captured under "Later").
- No redesign of any image visually — the QR card and product art look the same.

## Approach (chosen)

Fix the assets at the source **and** introduce one reusable image component
with a built-in loading skeleton. This addresses the real cause (file weight)
and the perceived experience (loading state), and is CMS-ready.

Rejected alternatives:
- **Preloading landing screen** — hides slowness, doesn't fix it, breaks for CMS.
- **Shrink files only, no skeletons** — faster, but images still pop in blank
  on slow connections and the QR still has an empty moment; misses the ask.

## Design

### 1. Asset re-encoding (root-cause fix)

Re-compress the oversized files in `public/brand/` in place (same filenames, so
no code references change). Visual appearance is preserved.

| File | Current | Target (approx) |
|---|---|---|
| `QRCode.png` | 2.0 MB | ~50–150 KB |
| `coffee_with_logo.png` | 2.3 MB | ~80–200 KB |
| `flash_sales.png` | 1.2 MB | ~150 KB |
| `celebration_in_a_cup.png` | 555 KB | ~120 KB |
| `latte_art_black_mug.png` | 778 KB | ~120 KB |
| `badge.png` | 421 KB | ~80 KB |
| `logo_transparent.png` | 103 KB | leave or minor |

The DuitNow QR must remain crisp and high-contrast so it always scans —
verified after re-encoding.

### 2. Reusable `SmartImage` component

New client component at `components/ui/smart-image.tsx` wrapping Next.js
`<Image>`:

- Renders a **skeleton shimmer** (Tailwind `animate-pulse`, soft grey, matching
  the app's neutral tone) sized to the image box while the image loads.
- Swaps to the real image on `onLoad`, with a gentle fade-in.
- On error, shows a **neutral fallback** (never a broken-image icon) — important
  for future CMS URLs that may 404.
- Accepts the same props already in use (`fill` or `width`/`height`, `sizes`,
  `alt`, `className`, `priority`) so adoption is mechanical.
- Works the same for local paths (today) and Supabase Storage URLs (later);
  remote optimization is already enabled via `next.config.ts`
  `images.remotePatterns`.

**Layout stability:** the skeleton occupies the image's reserved box before the
image arrives, so there is no layout shift.
- `fill`: skeleton fills the (already sized) parent container.
- `width`/`height`: skeleton matches those dimensions.

### 3. Adoption sites

Replace raw `<Image>` with `SmartImage` where catalog/content images render:

- `components/duitnow-qr-card.tsx` — checkout QR (top priority); keeps
  `priority`, gains skeleton. Save-to-device button untouched.
- `components/menu-card.tsx` — menu list thumbnails.
- `components/best-seller-carousel.tsx` — best-seller images.
- Product detail image — `app/(customer)/menu/[slug]/page.tsx` (the `<Image>`
  at the top of the product page; `product-customizer.tsx` renders no image).
- Rewards images — `components/rewards-catalog.tsx` /
  `components/rewards-screen.tsx`.

Left as plain `<Image>` (already instant, decorative chrome): the `/` splash
logo and small inline logos. No loading state needed for things already fast.

### 4. Verification

- **File sizes:** each re-encoded file is dramatically smaller (per table) and
  visually unchanged.
- **QR scannability:** re-encoded QR still scans cleanly; kept crisp/high-contrast.
- **Loading states:** dev server + DevTools network throttling (Slow 3G) — confirm
  skeleton shows first, image fades in, no layout jump, on checkout/menu/rewards.
- **Error path:** point a `SmartImage` at a bad URL once to confirm the neutral
  fallback (protects future CMS images).
- **Type/lint:** `npm run lint` and a typecheck pass clean before finishing.

**Cannot fully verify locally:** real phone-on-mobile-data speed cannot be
reproduced here; this will be called out rather than claimed as tested.

## Later (not in this task)

- **CMS upload compression:** when admins upload product photos, resize/compress
  on upload (e.g. in the storage upload server action) so large phone photos are
  stored small automatically. Pairs naturally with `SmartImage` on the read side.

## Files Touched

- `public/brand/*.png` — re-encoded in place.
- `components/ui/smart-image.tsx` — new.
- `components/duitnow-qr-card.tsx`, `components/menu-card.tsx`,
  `components/best-seller-carousel.tsx`, `components/rewards-catalog.tsx`,
  `components/rewards-screen.tsx`, `app/(customer)/menu/[slug]/page.tsx` —
  adopt `SmartImage`.
- Possibly `app/globals.css` — only if a custom shimmer keyframe is needed beyond
  `animate-pulse`.
