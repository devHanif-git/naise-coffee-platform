# Branching & Deploys

Two long-lived branches, two deployed environments.

```
fix/*  feat/*  ──PR──►  development  ──PR──►  master
                          │                     │
                    Staging site            Production site
                 (naise-coffee-dev)        (naise-coffee app)
                 separate Supabase         production Supabase
```

Both apps live in the same Azure subscription and can share one App Service
Plan, so staging adds no extra compute cost. Only the Supabase project and the
build-time env differ between them.

## The flow

1. Branch off `development`: `git checkout development && git pull && git checkout -b fix/my-thing`
2. Do the work, push, open a PR. The PR targets `development` automatically (it's the default branch).
3. Merge into `development`. This auto-deploys to the **staging** site.
4. Test staging on real devices / other networks. Demo there.
5. When staging is good, open a PR from `development` → `master` and merge.
   Merging to `master` auto-deploys to **production** (users feel it).

Production only ever ships from `master`, so merging fixes into `development`
one by one never touches the live site.

## Workflows

- `.github/workflows/azure-deploy.yml` — fires on push to `master` → production app `naise-coffee`.
- `.github/workflows/azure-deploy-staging.yml` — fires on push to `development` → staging app `naise-coffee-dev`.
  Gated by the `STAGING_ENABLED` repo variable so it stays off until setup below is done.

## One-time staging setup

### 1. Azure (same subscription as production)

- Create a Linux Web App, Node 22 runtime. Name it `naise-coffee-dev`
  (or edit `app-name` in the staging workflow to match).
- To avoid extra cost, put it in the **same App Service Plan** as
  `naise-coffee` (one plan can host multiple apps). Use a separate plan only if
  you want staging fully isolated from production resources.
- Get its publish profile: Web App → **Download publish profile**.
- Set its runtime env: Web App → **Settings → Configuration → Application settings**, add:
  - `SUPABASE_SERVICE_ROLE_KEY` (from the staging Supabase project)
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (a test bot/chat, so staging notifications don't hit the real group)

### 2. Supabase (separate staging project)

- Create a new Supabase project for staging.
- Apply the schema: run the migrations in `supabase/migrations/` against it.
- Copy its Project URL and publishable key (`sb_publishable_...`).

### 3. GitHub (repo Settings → Secrets and variables → Actions)

Add these **secrets**:

| Secret | Value |
|---|---|
| `AZURE_WEBAPP_PUBLISH_PROFILE_STAGING` | the publish profile XML from step 1 |
| `NEXT_PUBLIC_SUPABASE_URL_STAGING` | staging Supabase URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_STAGING` | staging publishable key |
| `NEXT_PUBLIC_SITE_URL_STAGING` | `https://naise-coffee-dev.azurewebsites.net` |
| `NEXT_PUBLIC_WHATSAPP_NUMBER_STAGING` | test WhatsApp number |

Add this **variable**:

| Variable | Value |
|---|---|
| `STAGING_ENABLED` | `true` |

Once `STAGING_ENABLED` is `true` and the secrets exist, the next merge into
`development` deploys staging. Until then the staging workflow is skipped.
