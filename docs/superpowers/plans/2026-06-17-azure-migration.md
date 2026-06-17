# Azure App Service Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate NAISE COFFEE from Cloudflare Workers (OpenNext adapter, hitting free-plan error 1102) to Azure App Service running a standard Next.js Node server, while keeping the domain on Cloudflare DNS proxied in front.

**Architecture:** Drop the OpenNext Cloudflare adapter and build with standard Next.js `output: "standalone"` → `node server.js`. Host on Azure App Service (Linux B1, Node 22). Deploy via GitHub Actions on push to `master` using a publish profile. Cloudflare stays in front (proxied, Full strict TLS) with an Azure-issued free managed cert.

**Tech Stack:** Next.js 16.2.9, React 19, Supabase SSR, Azure App Service (Linux, Node 22), GitHub Actions, Cloudflare DNS.

## Global Constraints

- App Service tier: **Linux B1**, region **East Asia** (Hong Kong) — nearest student-allowed region to Malaysia (Southeast Asia is blocked by the Azure for Students region policy).
- Node version pinned to **20** in BOTH the CI build and the App Service runtime — they must match.
- `NEXT_PUBLIC_*` env vars are **inlined at build time** → must be present in the GitHub Actions build step (GitHub repo secrets).
- Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) are **read at runtime** → set on the Azure Web App, never in CI, never committed.
- `NEXT_PUBLIC_SITE_URL` = `https://naisecoffee.utemride.my` (production value).
- Standalone build does NOT copy `public/` or `.next/static` automatically — the CI workflow MUST copy both.
- Domain: `naisecoffee.utemride.my`. App name target: `naise-coffee` (→ `naise-coffee.azurewebsites.net`).
- Never commit `.env*` or `.mcp.json`.

> **Legend:** Tasks marked **[CODE]** are file changes done in this repo. Tasks marked **[MANUAL]** are steps only the account owner can perform in the Azure portal / Azure CLI / Cloudflare dashboard / GitHub settings — the plan gives exact commands and values to run.

---

### Task 1: Security fixes — leaked token & gitignore [CODE + MANUAL]

**Files:**
- Modify: `.gitignore`
- Modify: `.mcp.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean `.gitignore` (ignores `.env*`, `.mcp.json`) and a `.mcp.json` that reads the GitHub token from `${GITHUB_PERSONAL_ACCESS_TOKEN}` instead of hardcoding it.

- [/] **Step 1 [MANUAL]: Revoke the leaked GitHub token NOW**

The token `ghp_…REDACTED…` is in `.mcp.json` in cleartext. Treat it as compromised.
Go to https://github.com/settings/tokens → find the token → **Delete / Revoke**. Then generate a fresh one if you still need GitHub MCP.

- [ ] **Step 2 [CODE]: Confirm neither secret file is tracked**

Run: `git ls-files .env.local .mcp.json`
Expected: empty output (neither is tracked). If either prints, stop and remove from git history before continuing.

- [ ] **Step 3 [CODE]: Add `.env*` and `.mcp.json` to `.gitignore`**

Add under the `# secrets / credentials` section:

```gitignore
# env files (real keys live here — never commit)
.env*
!.env.example

# local MCP config (may contain tokens)
.mcp.json
```

- [ ] **Step 4 [CODE]: Rewrite `.mcp.json` to read the token from env**

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=hodukwhqjhjzyfxlsovp"
    },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

- [ ] **Step 5 [CODE]: Verify gitignore works**

Run: `git check-ignore .env.local .mcp.json`
Expected: both paths printed (= both ignored).

- [ ] **Step 6 [CODE]: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore env files and mcp config; stop hardcoding token"
```
(Note: `.mcp.json` is now ignored, so it won't be staged — that's intended.)

---

### Task 2: Remove the OpenNext Cloudflare adapter [CODE]

**Files:**
- Modify: `next.config.ts`
- Modify: `package.json`
- Delete: `wrangler.jsonc`, `open-next.config.ts`
- Delete (if present): `cloudflare-env.d.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a repo that builds with plain `next build` and emits `.next/standalone/server.js`.

- [ ] **Step 1: Rewrite `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```
(Removes the `initOpenNextCloudflareForDev()` hook and adds standalone output.)

- [ ] **Step 2: Update `package.json` scripts**

Replace the `scripts` block with:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
```
(Drops `preview`, `deploy`, `cf-typegen`.)

- [ ] **Step 3: Remove Cloudflare dependencies**

Run: `npm uninstall @opennextjs/cloudflare wrangler`
Expected: both removed from `package.json` dependencies/devDependencies, `package-lock.json` updated.

- [ ] **Step 4: Delete Cloudflare config files**

```bash
git rm wrangler.jsonc open-next.config.ts
rm -f cloudflare-env.d.ts
```

- [ ] **Step 5: Verify no lingering Cloudflare imports**

Run: `grep -rn "opennextjs\|cloudflare" --include="*.ts" --include="*.tsx" --include="*.json" . --exclude-dir=node_modules --exclude-dir=.next`
Expected: no matches in source files (matches only inside docs/specs are fine).

- [ ] **Step 6: Commit**

```bash
git add next.config.ts package.json package-lock.json
git commit -m "build: drop OpenNext Cloudflare adapter, use Next standalone output"
```

---

### Task 3: Verify the standalone build locally [CODE]

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: Task 2's `output: "standalone"` config.
- Produces: confidence that `node .next/standalone/server.js` serves the app with assets.

- [ ] **Step 1: Clean build**

Run: `rm -rf .next && npm run build`
Expected: build completes, no errors; output mentions `Creating an optimized production build` and finishes with route list. A `.next/standalone/` folder now exists.

- [ ] **Step 2: Copy assets into standalone (the gotcha)**

Run: `cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/`
Expected: no errors.

- [ ] **Step 3: Start the standalone server**

Run: `PORT=3000 node .next/standalone/server.js`
Expected: logs `▲ Next.js 16.2.9` and `Ready` / listening on port 3000.

- [ ] **Step 4: Verify it responds with assets**

In another terminal: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/`
Expected: `200`. Open http://localhost:3000 in a browser — the storefront renders WITH styling/images (proves `public` + `.next/static` are served). Stop the server with Ctrl-C.

- [ ] **Step 5: No commit** (verification only — nothing changed).

---

### Task 4: GitHub Actions deploy workflow [CODE]

**Files:**
- Create: `.github/workflows/azure-deploy.yml`

**Interfaces:**
- Consumes: standalone build from Task 2; GitHub secrets created in Task 6.
- Produces: a workflow that builds on push to `master`, packages standalone + assets, and deploys to the Web App named `naise-coffee`.

- [ ] **Step 1: Create the workflow file**

```yaml
name: Deploy to Azure App Service

on:
  push:
    branches: [master]
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node 22
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build (NEXT_PUBLIC_* inlined here)
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }}
          NEXT_PUBLIC_SITE_URL: ${{ secrets.NEXT_PUBLIC_SITE_URL }}
        run: npm run build

      - name: Assemble standalone bundle
        run: |
          cp -r public .next/standalone/
          cp -r .next/static .next/standalone/.next/

      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v3
        with:
          app-name: naise-coffee
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: .next/standalone
```

- [ ] **Step 2: Validate YAML syntax**

Run: `npx --yes yaml-lint .github/workflows/azure-deploy.yml` (or open in editor — no red squiggles).
Expected: valid YAML, no parse errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/azure-deploy.yml
git commit -m "ci: add Azure App Service deploy workflow"
```

---

### Task 5: Create Azure resources [MANUAL]

**Files:** none — Azure CLI commands run by the account owner.

**Interfaces:**
- Consumes: nothing.
- Produces: resource group `naise-coffee-rg`, plan `naise-coffee-plan` (B1 Linux), Web App `naise-coffee` on Node 22 with startup command `node server.js`, and all runtime app settings.

- [/] **Step 1: Log in and select subscription**

```bash
az login
az account list --output table
az account set --subscription "<your Azure for Students subscription>"
```
Expected: `az account show` reflects the student subscription.

- [/] **Step 2: Create resource group**

```bash
az group create --name naise-coffee-rg --location eastasia
```
Expected: JSON with `"provisioningState": "Succeeded"`.

- [/] **Step 3: Create the App Service plan (Linux B1)**

```bash
az appservice plan create \
  --name naise-coffee-plan \
  --resource-group naise-coffee-rg \
  --location eastasia \
  --is-linux \
  --sku B1
```
Expected: `"provisioningState": "Succeeded"`, `"reserved": true` (= Linux).

- [/] **Step 4: Create the Web App on Node 22**

```bash
az webapp create \
  --name naise-coffee \
  --resource-group naise-coffee-rg \
  --plan naise-coffee-plan \
  --runtime "NODE:22-lts"
```
Expected: JSON with the app's `defaultHostName` = `naise-coffee.azurewebsites.net`. (If the name is taken, pick another and update Task 4's `app-name` + all later references.)

> Note: `NODE:20-lts` is NOT available on Azure for Students Linux — only `NODE:24-lts` and `NODE:22-lts` (`az webapp list-runtimes --os-type linux`). We use `22-lts` to match local Node v22.

- [/] **Step 5: Set the startup command**

```bash
az webapp config set \
  --name naise-coffee \
  --resource-group naise-coffee-rg \
  --startup-file "node server.js"
```
Expected: `"appCommandLine": "node server.js"` in the output.

- [/] **Step 6: Set runtime app settings (server secrets + build flag)**

Replace the `<...>` values with your real ones from `.env.local`:

```bash
az webapp config appsettings set \
  --name naise-coffee \
  --resource-group naise-coffee-rg \
  --settings \
    SCM_DO_BUILD_DURING_DEPLOYMENT=false \
    WEBSITES_PORT=3000 \
    TELEGRAM_BOT_TOKEN="<telegram bot token>" \
    TELEGRAM_CHAT_ID="<telegram chat id>"
```
Expected: JSON array listing the settings. (`WEBSITES_PORT=3000` tells App Service which port `server.js` listens on; `SCM_DO_BUILD_DURING_DEPLOYMENT=false` because we build in CI.)

> Note: NO `NEXT_PUBLIC_*` vars go here. They are inlined into the bundle at
> build time (in CI, from GitHub secrets), including `NEXT_PUBLIC_SITE_URL`
> even though it's read in server code — `NEXT_PUBLIC_` values are baked in as
> literals at build, so setting them at runtime is a no-op. `SUPABASE_SERVICE_ROLE_KEY`
> is also omitted: the codebase never reads it (no admin/CMS work yet). Only
> genuinely runtime-read secrets (`TELEGRAM_*`) plus the two App Service flags belong here.

- [/] **Step 7: Verify settings landed**

Run: `az webapp config appsettings list --name naise-coffee --resource-group naise-coffee-rg --output table`
Expected: the four settings present (`SCM_DO_BUILD_DURING_DEPLOYMENT`, `WEBSITES_PORT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).

---

### Task 6: Wire GitHub secrets & publish profile [MANUAL]

**Files:** none — GitHub repo settings + one Azure CLI call.

**Interfaces:**
- Consumes: Web App from Task 5.
- Produces: five GitHub Actions secrets the workflow (Task 4) needs.

- [/] **Step 1: Download the publish profile**

```bash
az webapp deployment list-publishing-profiles \
  --name naise-coffee \
  --resource-group naise-coffee-rg \
  --xml > publish-profile.xml
```
Expected: an XML file with `<publishData>`. This file is a live credential and is NOT covered by `.gitignore` — you must delete it (Step 3) and never commit it.

- [/] **Step 2: Add `AZURE_WEBAPP_PUBLISH_PROFILE` secret**

GitHub repo → Settings → Secrets and variables → Actions → New repository secret.
Name: `AZURE_WEBAPP_PUBLISH_PROFILE`. Value: paste the entire contents of `publish-profile.xml`.

- [/] **Step 3: Delete the local profile file**

Run: `rm publish-profile.xml`
Expected: file gone (it's a live credential — don't leave it on disk or commit it).

- [/] **Step 4: Add the four `NEXT_PUBLIC_*` build secrets**

Add each as a repository secret (same screen as Step 2), values from `.env.local`:

| Secret name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | your `sb_publishable_...` key |
| `NEXT_PUBLIC_SITE_URL` | `https://naisecoffee.utemride.my` |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | your WhatsApp number (digits only) |

- [/] **Step 5: Verify**

GitHub → Settings → Secrets and variables → Actions should list all **five** secrets.

---

### Task 7: First deploy & verify on azurewebsites.net [MANUAL + CODE]

**Files:** none — triggers the workflow and verifies.

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces: a live app at `https://naise-coffee.azurewebsites.net`.

- [ ] **Step 1: Merge the migration work to `master`**

The deploy triggers on push to `master`. Merge `dev` → `master` (open a PR, or fast-forward if that's your flow). Confirm with the user before pushing to `master`.

- [ ] **Step 2: Watch the Actions run**

GitHub → Actions tab → the `Deploy to Azure App Service` run.
Expected: all steps green; the deploy step finishes with a success message.

- [ ] **Step 3: Verify the app responds**

Run: `curl -s -o /dev/null -w "%{http_code}" https://naise-coffee.azurewebsites.net/`
Expected: `200`.

- [ ] **Step 4: Browser smoke test**

Open `https://naise-coffee.azurewebsites.net` — storefront renders with styling/images, menu loads (Supabase reachable), and you can sign in (OAuth callback works). If sign-in fails, check Supabase Auth → URL Configuration includes the azurewebsites.net URL and later the custom domain.

- [ ] **Step 5: Check logs if anything is off**

Run: `az webapp log tail --name naise-coffee --resource-group naise-coffee-rg`
Expected: request logs; no repeated startup crashes.

---

### Task 8: DNS & TLS cutover — Cloudflare in front [MANUAL]

**Files:** none — Cloudflare dashboard + Azure portal/CLI. **Order matters** (Azure's free managed cert can't validate through Cloudflare's proxy).

**Interfaces:**
- Consumes: a verified-live app (Task 7).
- Produces: `https://naisecoffee.utemride.my` served through Cloudflare (proxied, Full strict) → Azure, with an Azure-issued managed cert.

- [ ] **Step 1: Add CNAME in Cloudflare — DNS-only (grey cloud)**

Cloudflare → DNS → Add record:
- Type: `CNAME`, Name: `naisecoffee`, Target: `naise-coffee.azurewebsites.net`, Proxy status: **DNS only (grey cloud)**.

- [ ] **Step 2: Add the Azure domain-verification TXT record**

First get the verification id:
```bash
az webapp show --name naise-coffee --resource-group naise-coffee-rg --query customDomainVerificationId -o tsv
```
In Cloudflare add: Type `TXT`, Name: `asuid.naisecoffee`, Content: the value from above. Proxy: N/A for TXT.

- [ ] **Step 3: Bind the custom domain in Azure**

```bash
az webapp config hostname add \
  --webapp-name naise-coffee \
  --resource-group naise-coffee-rg \
  --hostname naisecoffee.utemride.my
```
Expected: success (Azure resolves the CNAME + TXT while grey-cloud/DNS-only). If it errors about verification, wait for DNS propagation (a few minutes) and retry.

- [ ] **Step 4: Create & bind the free managed certificate**

```bash
az webapp config ssl create \
  --resource-group naise-coffee-rg \
  --name naise-coffee \
  --hostname naisecoffee.utemride.my
```
Then bind it (the create step may auto-bind; if not, use the thumbprint it returns):
```bash
az webapp config ssl bind \
  --resource-group naise-coffee-rg \
  --name naise-coffee \
  --certificate-thumbprint <thumbprint-from-create> \
  --ssl-type SNI
```
Expected: cert issued and bound. Verify in Azure portal → Web App → Custom domains shows the domain **Secured**.

- [ ] **Step 5: Flip the CNAME to proxied (orange cloud)**

Cloudflare → DNS → edit the `naisecoffee` CNAME → Proxy status: **Proxied (orange cloud)**.

- [ ] **Step 6: Set Cloudflare SSL/TLS mode to Full (strict)**

Cloudflare → SSL/TLS → Overview → encryption mode: **Full (strict)**. (Valid now because Azure has a real managed cert on the origin.)

- [ ] **Step 7: Verify end-to-end HTTPS**

Run: `curl -s -o /dev/null -w "%{http_code}" https://naisecoffee.utemride.my/`
Expected: `200`. Browser: padlock valid, site loads through the custom domain. Check `curl -sI https://naisecoffee.utemride.my | grep -i server` shows `cloudflare` (proxy active).

- [ ] **Step 8: Update Supabase Auth redirect URLs**

Supabase dashboard → Authentication → URL Configuration → ensure Site URL and redirect allow-list include `https://naisecoffee.utemride.my` (and the OAuth callback path). Test Google sign-in on the live custom domain.

---

## Post-migration cleanup (optional)

- Delete the Cloudflare Worker `naise-coffee-platform` from the Cloudflare dashboard (no longer serving traffic).
- Remove now-unused `public/_headers` (Cloudflare-specific) if confirmed unneeded.
- Consider hardening CI auth from publish profile to OIDC federated identity later.
