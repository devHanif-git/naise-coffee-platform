# Azure Migration Design — NAISE COFFEE

**Date:** 2026-06-17
**Status:** Approved (pending spec review)
**Author:** devHanif + Claude

## Problem

The app is deployed on Cloudflare Workers via the OpenNext adapter. On the
Cloudflare free plan it repeatedly hits **error 1102** (Worker exceeded CPU /
resource limits). The fix is to move hosting to **Azure App Service**, funded by
an Azure for Students $200 credit, while keeping the existing domain on
Cloudflare DNS.

## Goals

- Run the app on Azure App Service with no recurring Cloudflare Workers limits.
- Keep `naisecoffee.utemride.my` on Cloudflare DNS, proxied, with valid HTTPS.
- Automate deploys via GitHub Actions on push to `master`.
- Remove the now-unnecessary OpenNext/Cloudflare build tooling.
- Fix two security issues discovered during exploration (leaked token, missing
  `.env*` ignore).

## Non-Goals

- Migrating off the Edge `middleware.ts` to Node `proxy.ts` (works as-is; future
  work).
- Changing Supabase, app features, or UI.
- Hardening CI auth to OIDC (publish profile is sufficient for now; future work).
- Push notifications / PWA changes.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Compute service | **App Service (Linux, B1, Node 22)** | Runs standard Next.js Node server directly; no containers; B1 (~$13/mo) fits the credit. |
| Build model | **Standard `next build` standalone** (drop OpenNext) | Removes Cloudflare adapter quirks; smaller artifact; faster cold start. |
| Deploy method | **GitHub Actions CI/CD** on push to `master` | Matches existing git workflow; no manual steps after setup. |
| GitHub→Azure auth | **Publish profile** | Fewest moving parts for a solo project; can harden to OIDC later. |
| DNS/TLS | **Cloudflare proxied + Full (strict)**, ordered cert cutover | Keeps CF CDN/DDoS/caching; Azure free managed cert. |
| Region | **East Asia** (Hong Kong) | Nearest student-allowed region to Malaysia (Southeast Asia is blocked by the Azure for Students region policy). |

## Architecture

```
Visitor
  │  HTTPS
  ▼
Cloudflare (proxied, Full strict)  ── DNS: naisecoffee.utemride.my
  │  HTTPS
  ▼
Azure App Service (Linux B1, Node 22)
  └─ node server.js  (Next.js standalone)
        │
        ▼
   Supabase (auth, Postgres, storage)  +  Telegram (order notifications)
```

## Build & Runtime Model

- Drop the OpenNext Cloudflare adapter; use plain `next build` → `next start`.
- Set `output: "standalone"` in `next.config.ts`; build emits
  `.next/standalone/server.js`. Startup command: `node server.js`.
- `middleware.ts` (Edge) keeps working on Node — it only uses `@supabase/ssr`,
  which is runtime-agnostic. No change needed.

## Repo Changes

**Remove (Cloudflare-specific):**
- `wrangler.jsonc`
- `open-next.config.ts`
- `cloudflare-env.d.ts` (if present)
- Dependencies: `@opennextjs/cloudflare`, `wrangler`
- `package.json` scripts: `preview`, `deploy`, `cf-typegen`
- `initOpenNextCloudflareForDev()` call in `next.config.ts`
- `.gitignore` Cloudflare entries (`.open-next/`, `.wrangler/`, `.dev.vars`) — optional cleanup

**Change:**
- `next.config.ts` → add `output: "standalone"`, remove OpenNext dev hook
- `package.json` → plain `dev`/`build`/`start`/`lint` scripts; drop CF deps
- `.gitignore` → add `.env*` (keep `!.env.example`)

**Add:**
- `.github/workflows/azure-deploy.yml`

**Keep untouched:**
- `middleware.ts`, `lib/supabase/*`, all app code (none is Cloudflare-coupled)

## Azure Resources

- **Resource group:** `naise-coffee-rg` (East Asia)
- **App Service Plan:** Linux, B1
- **Web App:** Node 22 LTS, startup command `node server.js`

### App settings (runtime, on the Web App)
- `TELEGRAM_BOT_TOKEN` (secret — used in `lib/telegram.ts`)
- `TELEGRAM_CHAT_ID` (secret — used in `lib/telegram.ts`)
- `WEBSITES_PORT` = `3000`
- `SCM_DO_BUILD_DURING_DEPLOYMENT` = `false`

> All `NEXT_PUBLIC_*` vars (including `NEXT_PUBLIC_SITE_URL`) are inlined into the
> bundle at build time and are NOT read from `process.env` at runtime — they live
> only as GitHub Actions build secrets, never as Web App settings.
> `SUPABASE_SERVICE_ROLE_KEY` is omitted: the codebase never reads it (no admin/CMS
> work yet). Add it only when server-side admin code that bypasses RLS is introduced.

## CI/CD Workflow

`.github/workflows/azure-deploy.yml`:

1. **Trigger:** push to `master`.
2. **Build:** checkout → Node 22 → `npm ci` → `npm run build` with the four
   `NEXT_PUBLIC_*` values injected from GitHub repo secrets.
3. **Package:** zip `.next/standalone` + `.next/static` + `public/` (standalone
   does not copy `static`/`public` automatically — workflow must add them).
4. **Deploy:** `azure/webapps-deploy@v3` with the publish profile.

### Build-time vs runtime env split

- **`NEXT_PUBLIC_*` (inlined at build):** must exist in the **GitHub Actions
  build step**. Stored as **GitHub repo secrets**.
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `NEXT_PUBLIC_WHATSAPP_NUMBER`
  - `NEXT_PUBLIC_SITE_URL`
- **Server-only (read at runtime):** set on the **Azure Web App**.
  - `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

## DNS & TLS Cutover (ordered)

Azure's free managed certificate cannot validate through a Cloudflare proxied
record, so order matters:

1. Confirm app is live at `naise-coffee.azurewebsites.net`.
2. Cloudflare DNS: add `CNAME naisecoffee → naise-coffee.azurewebsites.net`,
   **DNS-only (grey cloud)**. Add `TXT asuid.naisecoffee` with the Azure
   verification id.
3. Azure: add custom domain `naisecoffee.utemride.my`; Azure validates via the
   records.
4. Azure: create + bind **free managed certificate** for the domain.
5. Cloudflare: flip the CNAME back to **proxied (orange cloud)**; set SSL/TLS
   mode to **Full (strict)**.
6. Verify HTTPS end-to-end.

Exact record values produced once the final app name is set.

## Security Fixes (in scope)

1. **Leaked GitHub token:** `.mcp.json` contains a cleartext `ghp_...` PAT.
   - User revokes it at github.com/settings/tokens (treat as compromised).
   - Rewrite `.mcp.json` to read the token from an env var.
   - Add `.mcp.json` to `.gitignore`.
2. **Missing `.env*` ignore:** add `.env*` (with `!.env.example`) to `.gitignore`.
3. **Confirm nothing secret is tracked:** verified `.env.local` and `.mcp.json`
   are NOT in git (`git ls-files` returned empty). ✔

## Verification

- App builds locally with `output: "standalone"` and runs via `node server.js`.
- GitHub Actions run is green; artifact contains `static` + `public`.
- App reachable at `*.azurewebsites.net` before DNS cutover.
- After cutover: `https://naisecoffee.utemride.my` serves over HTTPS, OAuth
  login + WhatsApp checkout + Telegram notification all work.

## Rollback

Cloudflare Worker deploy is unchanged until DNS is flipped. If Azure fails,
revert the CNAME to the prior Cloudflare target — origin stays intact until
step 5.
