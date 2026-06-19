# Image Loading & DuitNow QR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make storefront images load fast and never look broken — shrink oversized brand assets and add a reusable image component with a skeleton loader, starting with the checkout DuitNow QR.

**Architecture:** Two independent fixes. (1) Re-encode the oversized PNGs in `public/brand/` in place using `sharp` (already in `node_modules` as a Next dependency) — same filenames, same visual result, far smaller files. (2) A small client component `SmartImage` wraps Next.js `<Image fill>` to show a `animate-pulse` skeleton while loading, fade the image in on load, and show a neutral fallback on error. Adopt it everywhere a catalog/content image renders. Both work identically for local paths today and Supabase Storage URLs later.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4, `sharp` 0.34.5 (re-encode only, via `node` script).

## Global Constraints

- TypeScript strict mode; **no `any`** (AGENTS.md).
- No new dependencies. `sharp` is already present transitively; use it via a throwaway `node` script, do not add it to `package.json`.
- Tailwind utility classes only; use the `cn()` helper from `lib/utils` for conditional classes. Static values use Tailwind arbitrary values, not inline `style` (AGENTS.md Styling Rules).
- Use the Next.js `<Image>` component for images (AGENTS.md Image Rule). `SmartImage` wraps it, not replaces it.
- Every image needs meaningful `alt` text; decorative images keep `alt=""` + `aria-hidden`.
- No test runner exists in this repo (only `eslint`). "Verification" steps below use `npm run lint`, `npx tsc --noEmit`, file-size inspection, and manual dev-server checks with DevTools network throttling — there are no unit tests to write.
- Commit after each task. Branch is `dev`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `scripts/reencode-brand-images.mjs` | One-off `sharp` re-encode of oversized brand PNGs in place | Create (throwaway, committed for reproducibility) |
| `public/brand/*.png` | Brand/catalog image assets | Modify (re-encoded bytes) |
| `components/ui/smart-image.tsx` | Reusable `<Image fill>` wrapper with skeleton + fade-in + error fallback | Create |
| `components/duitnow-qr-card.tsx` | Checkout QR card | Modify (adopt `SmartImage`) |
| `components/menu-card.tsx` | Menu list row thumbnail | Modify (adopt `SmartImage`) |
| `app/(customer)/menu/[slug]/page.tsx` | Product detail hero image | Modify (adopt `SmartImage`) |
| `components/best-seller-carousel.tsx` | Best-seller product image | Modify (adopt `SmartImage` for the product image only) |
| `components/rewards-catalog.tsx` | Rewards grid image | Modify (adopt `SmartImage`) |
| `components/rewards-screen.tsx` | Rewards rail image | Modify (adopt `SmartImage` for `reward.image` only) |

Decorative chrome stays plain `<Image>`: the `badge` in the best-seller carousel, and `latteArt` / `celebration` in the rewards screen (all `aria-hidden`). The `/` splash logo also stays plain.

---

## Task 1: Re-encode oversized brand images

**Files:**
- Create: `scripts/reencode-brand-images.mjs`
- Modify: `public/brand/QRCode.png`, `public/brand/coffee_with_logo.png`, `public/brand/flash_sales.png`, `public/brand/celebration_in_a_cup.png`, `public/brand/latte_art_black_mug.png`, `public/brand/badge.png` (bytes only)

**Interfaces:**
- Consumes: nothing.
- Produces: smaller files at the same paths. No code references change (filenames identical), so later tasks are unaffected by this task's output.

- [ ] **Step 1: Record current sizes (baseline)**

Run:
```bash
cd "/c/Users/devHanif/Documents/Projects_n_Programming/Random Projects/naisecoffee"
ls -la public/brand/*.png
```
Expected: confirms the heavy files (QRCode.png ~2.0 MB, coffee_with_logo.png ~2.3 MB, flash_sales.png ~1.2 MB, latte_art_black_mug.png ~778 KB, celebration_in_a_cup.png ~555 KB, badge.png ~421 KB).

- [ ] **Step 2: Write the re-encode script**

Create `scripts/reencode-brand-images.mjs`. It re-encodes each target PNG through `sharp`: downscale so the longest edge is at most a sensible cap, then write optimized PNG bytes back to the same path. PNG is kept (not WebP) so filenames/extensions and all `constants/images.ts` references stay valid. The QR is capped larger and at max compression effort to stay crisp and scannable.

```js
// scripts/reencode-brand-images.mjs
// One-off, idempotent re-encode of oversized brand PNGs, in place.
// Run with: node scripts/reencode-brand-images.mjs
// Uses sharp (already present via Next). Not a runtime dependency.
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BRAND_DIR = path.join(process.cwd(), "public", "brand");

// maxEdge: longest side in px after downscale (null = keep original dimensions).
// The QR keeps a large edge and high compression so it stays sharp/scannable.
const TARGETS = [
  { file: "QRCode.png", maxEdge: 1080 },
  { file: "coffee_with_logo.png", maxEdge: 900 },
  { file: "flash_sales.png", maxEdge: 1080 },
  { file: "latte_art_black_mug.png", maxEdge: 640 },
  { file: "celebration_in_a_cup.png", maxEdge: 640 },
  { file: "badge.png", maxEdge: 512 },
];

for (const { file, maxEdge } of TARGETS) {
  const filePath = path.join(BRAND_DIR, file);
  const input = await readFile(filePath);
  const before = input.length;

  const output = await sharp(input)
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, effort: 10, palette: true, quality: 90 })
    .toBuffer();

  // Safety: never write a result that came out larger than the source.
  if (output.length >= before) {
    console.log(`SKIP  ${file} (re-encode not smaller: ${before} -> ${output.length})`);
    continue;
  }

  await writeFile(filePath, output);
  const pct = Math.round((1 - output.length / before) * 100);
  console.log(`OK    ${file}  ${(before / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB  (-${pct}%)`);
}
```

- [ ] **Step 3: Run the script**

Run:
```bash
node scripts/reencode-brand-images.mjs
```
Expected: an `OK` line per file showing a large reduction (QRCode and coffee_with_logo should drop by ~85–95%; e.g. `QRCode.png 2007KB -> ~120KB`). No `Error`. If any line says `SKIP ... not smaller`, that file was already optimized — acceptable.

- [ ] **Step 4: Verify new sizes**

Run:
```bash
ls -la public/brand/*.png
```
Expected: `QRCode.png` and `coffee_with_logo.png` are each well under ~250 KB; `flash_sales.png` under ~250 KB; the others under ~150 KB.

- [ ] **Step 5: Verify QR still scans and images look unchanged**

Run:
```bash
npm run dev
```
Then in a browser open `http://localhost:3000/checkout` (add an item to the cart first if checkout requires it — from `/menu`, open any drink, add to cart, go to checkout). Confirm:
- The DuitNow QR renders crisp (no blur/artifacts on the QR squares).
- Scan the on-screen QR with a phone camera / DuitNow app — it resolves to the same payment target as before.
- Spot-check `/` (splash), `/menu`, `/rewards` — images look the same as before, just load faster.

Stop the dev server (Ctrl+C) when done.

- [ ] **Step 6: Commit**

```bash
git add scripts/reencode-brand-images.mjs public/brand
git commit -m "perf(images): re-encode oversized brand PNGs in place

QRCode.png and coffee_with_logo.png were ~2MB each. Downscale + recompress
via sharp keeps them visually identical (QR still scans) at a fraction of
the bytes — the main cause of slow image/QR loading.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create the `SmartImage` component

**Files:**
- Create: `components/ui/smart-image.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`; `Image`, `ImageProps` from `next/image`.
- Produces: `SmartImage` — a React component. Props: every `next/image` prop EXCEPT it requires `fill` usage (no `width`/`height` path). Specifically used as:
  `<SmartImage src={string} alt={string} fill sizes={string} className={string} priority?={boolean} aria-hidden?={boolean} />`.
  Renders an absolutely-positioned skeleton sibling, so the **parent element must be `position: relative` and have a defined size** — which every adoption site already is (they all use `<Image fill>` inside a sized `relative` box today).

- [ ] **Step 1: Write the component**

Create `components/ui/smart-image.tsx`:

```tsx
"use client";

import { useState } from "react";
import Image, { type ImageProps } from "next/image";
import { cn } from "@/lib/utils";

// A drop-in wrapper around <Image fill> that reserves the image's box with a
// soft skeleton while the image decodes, fades the image in once it loads, and
// shows a neutral placeholder (never a broken-image icon) if the source fails.
//
// Requires `fill` and a sized, position:relative parent — which all current
// adoption sites already provide. Works for local paths and remote (Supabase
// Storage) URLs alike.
type SmartImageProps = Omit<ImageProps, "onLoad" | "onError"> & {
  fill: true;
};

export function SmartImage({ className, alt, ...props }: SmartImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );

  return (
    <>
      {status !== "loaded" && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 animate-pulse rounded-[inherit] bg-muted",
            status === "error" && "animate-none",
          )}
        />
      )}
      {status !== "error" && (
        <Image
          {...props}
          alt={alt}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={cn(
            "transition-opacity duration-300",
            status === "loaded" ? "opacity-100" : "opacity-0",
            className,
          )}
        />
      )}
    </>
  );
}
```

Notes for the implementer:
- `rounded-[inherit]` makes the skeleton pick up the parent's corner radius so it matches the rounded image boxes.
- On `error`, the `<Image>` is removed and the skeleton stays as a static (non-pulsing) neutral box — graceful, no broken icon. This is what protects future CMS URLs that might 404.
- `bg-muted` is an existing design token (defined in `app/globals.css`), so the skeleton tone matches the app in light/dark.

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. (If it reports a pre-existing unrelated error elsewhere, confirm it is not in `components/ui/smart-image.tsx` and proceed.)

- [ ] **Step 3: Lint**

Run:
```bash
npm run lint
```
Expected: no new errors for `components/ui/smart-image.tsx`.

- [ ] **Step 4: Commit**

```bash
git add components/ui/smart-image.tsx
git commit -m "feat(ui): add SmartImage wrapper with skeleton + error fallback

Wraps <Image fill> to reserve the box with an animate-pulse skeleton while
loading, fade in on load, and show a neutral placeholder on error. CMS-ready.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Adopt SmartImage on the checkout DuitNow QR (priority)

**Files:**
- Modify: `components/duitnow-qr-card.tsx`

**Interfaces:**
- Consumes: `SmartImage` from `@/components/ui/smart-image` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Swap the QR `<Image>` for `SmartImage`**

In `components/duitnow-qr-card.tsx`, change the import on line 4 from:
```tsx
import Image from "next/image";
```
to:
```tsx
import { SmartImage } from "@/components/ui/smart-image";
```

Then replace the image block (currently lines ~62–69):
```tsx
        <Image
          src={QR_SRC}
          alt="Naise Coffee DuitNow QR code"
          fill
          sizes="(min-width: 640px) 480px, 100vw"
          className="object-contain"
          priority
        />
```
with:
```tsx
        <SmartImage
          src={QR_SRC}
          alt="Naise Coffee DuitNow QR code"
          fill
          sizes="(min-width: 640px) 480px, 100vw"
          className="object-contain"
          priority
        />
```

Leave everything else (the `saveToDevice` logic, the Save button, the `fetch(QR_SRC)` call) untouched — `QR_SRC` is still a valid path.

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint
```
Expected: no new errors.

- [ ] **Step 3: Manual loading-state check (throttled)**

Run `npm run dev`, open `http://localhost:3000/checkout` (with an item in the cart). In DevTools → Network, set throttling to **Slow 3G**, then hard-reload. Confirm:
- The QR square shows a grey pulsing skeleton first.
- The QR fades in when ready; the layout does not jump.
- Turn throttling off, reload — QR appears almost immediately (re-encoded + cached).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add components/duitnow-qr-card.tsx
git commit -m "feat(checkout): show skeleton while the DuitNow QR loads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Adopt SmartImage on menu card + product detail

**Files:**
- Modify: `components/menu-card.tsx`
- Modify: `app/(customer)/menu/[slug]/page.tsx`

**Interfaces:**
- Consumes: `SmartImage` from `@/components/ui/smart-image`.
- Produces: nothing new.

- [ ] **Step 1: Update `menu-card.tsx`**

Change the import on line 1 from:
```tsx
import Image from "next/image";
```
to:
```tsx
import { SmartImage } from "@/components/ui/smart-image";
```

Replace the image (currently lines ~19–25):
```tsx
            <Image
              src={product.image}
              alt={product.name}
              fill
              sizes="80px"
              className="object-contain"
            />
```
with:
```tsx
            <SmartImage
              src={product.image}
              alt={product.name}
              fill
              sizes="80px"
              className="object-contain"
            />
```

- [ ] **Step 2: Update the product detail page**

In `app/(customer)/menu/[slug]/page.tsx`, change the import on line 3 from:
```tsx
import Image from "next/image";
```
to:
```tsx
import { SmartImage } from "@/components/ui/smart-image";
```

Replace the hero image (currently lines ~81–88):
```tsx
        <Image
          src={product.image}
          alt={product.name}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 448px"
          className="object-contain p-5"
        />
```
with:
```tsx
        <SmartImage
          src={product.image}
          alt={product.name}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 448px"
          className="object-contain p-5"
        />
```

Note: line 33's `images: [{ url: product.image }]` in `generateMetadata` is unrelated (Open Graph metadata, not the `Image` component) — leave it.

This is a Server Component rendering a Client Component (`SmartImage`) — that is allowed in the App Router and needs no other change.

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint
```
Expected: no new errors.

- [ ] **Step 4: Manual check**

Run `npm run dev`. With Slow 3G throttling, visit `/menu` (thumbnails show skeletons then fade in) and open a product (hero shows skeleton then fades in). Confirm no layout jump. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add components/menu-card.tsx "app/(customer)/menu/[slug]/page.tsx"
git commit -m "feat(menu): skeleton loaders on menu thumbnails and product hero

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Adopt SmartImage in the best-seller carousel

**Files:**
- Modify: `components/best-seller-carousel.tsx`

**Interfaces:**
- Consumes: `SmartImage` from `@/components/ui/smart-image`.
- Produces: nothing new.

- [ ] **Step 1: Add the import**

Keep the existing `import Image from "next/image";` on line 4 (the decorative `badge` still uses plain `Image`). Add directly below it:
```tsx
import { SmartImage } from "@/components/ui/smart-image";
```

- [ ] **Step 2: Swap only the product image**

Replace the product image (currently lines ~144–150):
```tsx
                    <Image
                      src={product.image}
                      alt={product.name}
                      fill
                      sizes="(max-width: 768px) 90vw, 400px"
                      className="object-contain p-5 transition-transform duration-300 hover:scale-[1.03]"
                    />
```
with:
```tsx
                    <SmartImage
                      src={product.image}
                      alt={product.name}
                      fill
                      sizes="(max-width: 768px) 90vw, 400px"
                      className="object-contain p-5 transition-transform duration-300 hover:scale-[1.03]"
                    />
```

Leave the decorative `badge` `<Image>` (lines ~126–133, `aria-hidden`, fixed `width`/`height`) as plain `Image` — it is tiny chrome and not a `fill` image.

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint
```
Expected: no new errors. (`Image` is still imported and used by the badge, so no unused-import error.)

- [ ] **Step 4: Manual check**

Run `npm run dev`, visit `/home` (or wherever the carousel renders) with Slow 3G. Confirm each best-seller slide shows a skeleton then fades the drink in; the badge and pagination still work. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add components/best-seller-carousel.tsx
git commit -m "feat(home): skeleton loader on best-seller product images

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Adopt SmartImage in rewards (catalog + screen)

**Files:**
- Modify: `components/rewards-catalog.tsx`
- Modify: `components/rewards-screen.tsx`

**Interfaces:**
- Consumes: `SmartImage` from `@/components/ui/smart-image`.
- Produces: nothing new.

- [ ] **Step 1: Update `rewards-catalog.tsx`**

Change the import on line 3 from:
```tsx
import Image from "next/image";
```
to:
```tsx
import { SmartImage } from "@/components/ui/smart-image";
```

Replace the image (currently lines ~38–44):
```tsx
                <Image
                  src={reward.image}
                  alt={reward.name}
                  fill
                  sizes="(max-width: 768px) 50vw, 200px"
                  className="object-contain p-4"
                />
```
with:
```tsx
                <SmartImage
                  src={reward.image}
                  alt={reward.name}
                  fill
                  sizes="(max-width: 768px) 50vw, 200px"
                  className="object-contain p-4"
                />
```

(`rewards-catalog.tsx` uses no other `<Image>`, so the named import fully replaces the default import.)

- [ ] **Step 2: Update `rewards-screen.tsx`**

Keep the existing `import Image from "next/image";` on line 4 (the decorative `latteArt` and `celebration` images stay plain `Image`). Add directly below it:
```tsx
import { SmartImage } from "@/components/ui/smart-image";
```

Replace only the reward image (currently lines ~321–327):
```tsx
                    <Image
                      src={reward.image}
                      alt={reward.name}
                      fill
                      sizes="144px"
                      className="object-contain p-4"
                    />
```
with:
```tsx
                    <SmartImage
                      src={reward.image}
                      alt={reward.name}
                      fill
                      sizes="144px"
                      className="object-contain p-4"
                    />
```

Leave the `latteArt` (lines ~108–115) and `celebration` (lines ~360–367) decorative `<Image>` elements as plain `Image` — both are `aria-hidden` chrome with fixed `width`/`height`.

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint
```
Expected: no new errors. (`rewards-screen.tsx` still uses `Image` for the decorative images, so no unused-import error.)

- [ ] **Step 4: Manual check**

Run `npm run dev`, visit `/rewards` and `/rewards/catalog` with Slow 3G. Confirm reward images show skeletons then fade in; the decorative mug/celebration art still renders. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add components/rewards-catalog.tsx components/rewards-screen.tsx
git commit -m "feat(rewards): skeleton loaders on reward images

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Final verification sweep

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: confidence that the full set works together.

- [ ] **Step 1: Full typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint
```
Expected: clean (no new errors introduced by this branch).

- [ ] **Step 2: Production build**

Run:
```bash
npm run build
```
Expected: build completes successfully. Watch for any image/Next errors. (This also confirms the Server→Client `SmartImage` usage on the product page builds.)

- [ ] **Step 3: Error-path check (temporary)**

Temporarily point one `SmartImage` at a bad path to confirm the fallback. In `components/menu-card.tsx`, change `src={product.image}` to `src="/brand/does-not-exist.png"`. Run `npm run dev`, open `/menu`, and confirm the thumbnail shows the static neutral skeleton box (NOT a broken-image icon and NOT an endless pulse). Then **revert** the change:
```bash
git checkout components/menu-card.tsx
```
Confirm `git status` shows `menu-card.tsx` clean again.

- [ ] **Step 4: Cross-surface throttled pass**

Run `npm run dev` with Slow 3G throttling and walk: `/` → `/home` (carousel) → `/menu` → a product → `/checkout` (QR) → `/rewards` → `/rewards/catalog`. Confirm every catalog/QR image shows a skeleton then fades in, nothing pops in blank, and no layout shifts. Note that real mobile-network speed cannot be reproduced locally — report this pass as "verified under Slow 3G emulation," not as real-device testing.

- [ ] **Step 5: Confirm branch state**

Run:
```bash
git status
git log --oneline -7
```
Expected: working tree clean; the six feature commits (Tasks 1–6) present. Task 7 adds no commit.

---

## Self-Review (completed during planning)

- **Spec coverage:** Asset re-encoding → Task 1. `SmartImage` component (skeleton, fade-in, error fallback, CMS-ready) → Task 2. Adoption on QR/menu/product/best-seller/rewards → Tasks 3–6. Verification (sizes, QR scan, loading states, error path, lint/type/build) → Tasks 1, 3–7. "Later: CMS upload compression" → intentionally not a task (out of scope per spec).
- **Placeholder scan:** none — every code/edit step shows the exact before/after.
- **Type/name consistency:** `SmartImage` named export used identically in Tasks 3–6; requires `fill` (all six adoption sites use `fill`); `bg-muted` token confirmed present in `app/globals.css`; decorative `Image` imports deliberately retained in `best-seller-carousel.tsx` and `rewards-screen.tsx` to avoid unused-import lint errors.
- **Test infra note:** repo has no test runner; verification is lint + `tsc --noEmit` + `build` + manual throttled checks, stated honestly rather than inventing unit tests.
