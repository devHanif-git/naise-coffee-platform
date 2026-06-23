# Branching & Deploys

Two long-lived branches, one deployed environment (production).

```
fix/*  feat/*  ──PR──►  development  ──PR──►  master
                                              │
                                         Production site
                                         (naise-coffee)
```

## The flow

1. Branch off `development`: `git checkout development && git pull && git checkout -b fix/my-thing`
2. Do the work, push, open a PR. The PR targets `development` automatically (it's the default branch).
3. Merge into `development`. This is the integration branch — no deploy happens.
4. Test locally. When development is ready to ship, open a PR from `development` → `master` and merge.
5. Merging to `master` auto-deploys to **production** (users feel it).

Production only ever ships from `master`. Merging fixes into `development` one by one never touches the live site.

## Workflows

- `.github/workflows/azure-deploy.yml` — fires on push to `master` → production app `naise-coffee`.

## Branch protection

- **master**: requires a pull request, no direct push, no force-push, no deletion. Applies to everyone including admins.
- **development**: no direct-push restriction, but force-push and deletion are blocked.
