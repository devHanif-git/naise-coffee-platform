# PWA Service Worker + Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Naise Coffee an installable PWA by adding a Serwist service worker and a real icon set.

**Architecture:** Wrap the existing `next.config.ts` with `@serwist/next`, which compiles `app/sw.ts` into `public/sw.js` and auto-registers it. Caching is conservative (Serwist's `defaultCache`: precache build assets, network-first navigation, no caching of Supabase/auth/order data). Icons are generated from the existing logo with `sharp` and committed.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `@serwist/next` 9.x, `serwist` 9.x, `sharp` 0.34.

## Global Constraints

- Do NOT introduce libraries beyond `@serwist/next` (dep) and `serwist` (dev dep). `sharp` is already installed.
- Do NOT build push notifications.
- Do NOT cache authenticated data, orders, cart, or Supabase API calls.
- Do NOT add `"lib": ["webworker"]` to the root `tsconfig.json` (breaks DOM types app-wide). Scope worker types file-locally.
- Money/UI rules from AGENTS.md unchanged; this work touches config, manifest, layout metadata, and a build script only.
- Maskable/apple icon background color: `#171717` (existing `theme_color`).
- The repo uses `next.config.ts` (TypeScript) with `output: "standalone"`.

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (dependencies + devDependencies)

**Interfaces:**
- Produces: `@serwist/next` importable in `next.config.ts`; `serwist` + `@serwist/next/worker` importable in `app/sw.ts`.

- [ ] **Step 1: Install**

```bash
npm i @serwist/next && npm i -D serwist
```

- [ ] **Step 2: Verify versions resolved**

Run: `node -e "console.log(require('@serwist/next/package.json').version, require('serwist/package.json').version)"`
Expected: prints two `9.x` version strings, no error.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add serwist for PWA service worker"
```

---

### Task 2: Generate PWA icons

**Files:**
- Create: `scripts/generate-pwa-icons.mjs`
- Create (generated, committed): `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`, `public/icons/apple-touch-icon.png`

**Interfaces:**
- Consumes: `public/brand/logo_transparent.png` (640×640 RGBA), `sharp` (installed).
- Produces: four PNG files at the paths above, referenced by Task 4 (manifest) and Task 5 (layout).

- [ ] **Step 1: Write the icon generation script**

Create `scripts/generate-pwa-icons.mjs`:

```js
// Generates PWA icons from the brand logo using sharp.
// Run: node scripts/generate-pwa-icons.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public/brand/logo_transparent.png");
const OUT = path.join(ROOT, "public/icons");
const BG = "#171717"; // matches manifest theme_color

async function transparentIcon(size) {
  // Logo on transparent canvas with ~10% padding, for purpose: "any".
  const inner = Math.round(size * 0.8);
  const logo = await sharp(SRC).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, gravity: "center" }])
    .png();
}

async function solidIcon(size, scale) {
  // Logo centered on solid BG, for maskable + apple-touch (no transparency).
  const inner = Math.round(size * scale);
  const logo = await sharp(SRC).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "center" }])
    .png();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await (await transparentIcon(192)).toFile(path.join(OUT, "icon-192.png"));
  await (await transparentIcon(512)).toFile(path.join(OUT, "icon-512.png"));
  // Maskable: logo at 70% so it survives platform mask cropping (safe zone).
  await (await solidIcon(512, 0.7)).toFile(path.join(OUT, "icon-maskable-512.png"));
  await (await solidIcon(180, 0.8)).toFile(path.join(OUT, "apple-touch-icon.png"));
  console.log("PWA icons written to public/icons/");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run the script**

Run: `node scripts/generate-pwa-icons.mjs`
Expected: prints `PWA icons written to public/icons/`, exit 0.

- [ ] **Step 3: Verify the outputs exist and have correct dimensions**

Run: `node -e "const s=require('sharp'); for (const [f,w] of [['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512],['apple-touch-icon.png',180]]) s('public/icons/'+f).metadata().then(m=>console.log(f, m.width+'x'+m.height, m.width===w&&m.height===w?'OK':'WRONG'))"`
Expected: each line ends with `OK`.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-pwa-icons.mjs public/icons/
git commit -m "feat(pwa): generate 192/512/maskable/apple-touch icons from logo"
```

---

### Task 3: Add service worker source + ignore generated output

**Files:**
- Create: `app/sw.ts`
- Modify: `.gitignore`
- Modify: `tsconfig.json` (exclude generated SW only — NOT lib changes)

**Interfaces:**
- Consumes: `@serwist/next/worker` (`defaultCache`), `serwist` (`Serwist`, types). Installed in Task 1.
- Produces: `swSrc` target `app/sw.ts` consumed by Task 4's `next.config.ts` wrapper.

- [ ] **Step 1: Write the service worker**

Create `app/sw.ts`:

```ts
/// <reference lib="webworker" />
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

The `/// <reference lib="webworker" />` is file-scoped — it does NOT leak `webworker` types to the rest of the app.

- [ ] **Step 2: Ignore generated SW artifacts**

Add to `.gitignore` (append):

```
# Serwist-generated service worker (built from app/sw.ts)
public/sw.js
public/sw.js.map
public/swe-worker-*.js
```

- [ ] **Step 3: Exclude generated SW from tsconfig**

In `tsconfig.json`, add `"public/sw.js"` to the `exclude` array so the generated file is never type-checked. Change:

```json
  "exclude": ["node_modules"]
```

to:

```json
  "exclude": ["node_modules", "public/sw.js"]
```

Do NOT modify `compilerOptions.lib` or `compilerOptions.types`.

- [ ] **Step 4: Type-check the worker source**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors referencing `app/sw.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/sw.ts .gitignore tsconfig.json
git commit -m "feat(pwa): add serwist service worker source"
```

---

### Task 4: Wire service worker into next.config.ts

**Files:**
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `@serwist/next` default export `withSerwistInit`; `app/sw.ts` from Task 3.
- Produces: build emits `public/sw.js`; auto-registration injected into the app.

- [ ] **Step 1: Wrap the existing config**

In `next.config.ts`, add the import at the top (after existing imports):

```ts
import withSerwistInit from "@serwist/next";
```

Add after the `nextConfig` object definition, before the existing `export default`:

```ts
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // A live SW fighting Next's dev HMR causes stale-asset confusion.
  // Exercise the SW via `next build && next start` instead.
  disable: process.env.NODE_ENV === "development",
});
```

Change the existing `export default nextConfig;` to:

```ts
export default withSerwist(nextConfig);
```

- [ ] **Step 2: Build and confirm the SW is emitted**

Run: `npm run build`
Expected: build completes successfully (exit 0), no type errors.

- [ ] **Step 3: Verify the generated service worker exists**

Run: `node -e "require('node:fs').accessSync('public/sw.js'); console.log('sw.js present')"`
Expected: prints `sw.js present`.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts
git commit -m "feat(pwa): compile and register service worker via serwist"
```

---

### Task 5: Manifest icons + iOS metadata

**Files:**
- Modify: `app/manifest.ts`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: icon files from Task 2 (`public/icons/*`).
- Produces: complete installable manifest + iOS home-screen metadata.

- [ ] **Step 1: Update manifest icons**

In `app/manifest.ts`, replace the entire `icons` array (and remove the `TODO` comment) with:

```ts
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
```

- [ ] **Step 2: Add iOS metadata to root layout**

In `app/layout.tsx`, extend the existing `metadata` object. Add these two properties inside the `Metadata` object (after `openGraph`):

```ts
  appleWebApp: { capable: true, title: "Naise", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Build to confirm manifest + metadata compile**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/manifest.ts app/layout.tsx
git commit -m "feat(pwa): wire real icons + iOS home-screen metadata"
```

---

### Task 6: Manual PWA verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: production build from Tasks 4–5.

- [ ] **Step 1: Build and start production server**

```bash
npm run build && npm run start
```

Expected: server starts on `http://localhost:3000`.

- [ ] **Step 2: Verify manifest link is emitted**

Run (in a second terminal): `curl -s http://localhost:3000/ | grep -o 'rel="manifest"[^>]*\|manifest.webmanifest'`
Expected: at least one match (Next auto-emits `<link rel="manifest" href="/manifest.webmanifest">`).

- [ ] **Step 3: Verify the manifest serves valid JSON with maskable icon**

Run: `curl -s http://localhost:3000/manifest.webmanifest | node -e "const m=JSON.parse(require('node:fs').readFileSync(0));const mask=m.icons.find(i=>i.purpose==='maskable');console.log('name:',m.name,'| icons:',m.icons.length,'| maskable:',!!mask)"`
Expected: `name: Naise Coffee | icons: 3 | maskable: true`.

- [ ] **Step 4: Verify the service worker is served**

Run: `curl -sI http://localhost:3000/sw.js | head -1`
Expected: `HTTP/1.1 200 OK` (or `200`).

- [ ] **Step 5: Browser checks (manual, document results)**

In Chrome → DevTools → Application:
- Manifest panel: name, 3 icons (one maskable), theme color `#171717`, no errors.
- Service Workers panel: a worker is "activated and running".
- Confirm installability (install icon appears in address bar / "Installability" has no warnings).
- Network tab → toggle Offline → reload: app shell loads; then navigate to an authenticated/order page and confirm live data is NOT served stale (Supabase calls fail rather than returning cached order data).

Expected: all of the above hold. Note any deviation.

- [ ] **Step 6: No commit** (verification only). If browser checks reveal issues, return to the relevant task.

---

## Notes for the implementer

- Run all commands from the repo root: `C:/Users/devHanif/Documents/Projects_n_Programming/Random Projects/naisecoffee`.
- The shell is Git Bash on Windows; `npm run start` is the production server (the script is `next start`).
- If `npm run build` reports a type error in `public/sw.js` despite the tsconfig exclude, confirm Step 3 of Task 3 was applied (the exclude entry). The generated file should never be type-checked.
- If auto-registration does not appear to work in the browser, confirm `disable` is false in production (it keys off `NODE_ENV`, which `next build` sets to `production`).
