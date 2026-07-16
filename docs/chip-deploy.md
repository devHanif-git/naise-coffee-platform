# CHIP DuitNow QR — Production Deploy Notes

Deploy guide for the CHIP-gateway DuitNow QR payment feature
(`feature/payment-integration`). Most DB work is already live in prod (applied
via Supabase MCP during the build), so this is mostly **env vars + CHIP portal
config + the code merge**.

---

## 1. Already done in prod (no action needed)

Applied to the live Supabase during the build:

- Migrations: `chip_fee_and_voucher`, `chip_expire_cron`, `chip_fee_min_max` —
  the `orders` / `payment_settings` columns and the reused `chip_purchases`
  table all exist.
- pg_cron job `chip-expire-abandoned` — runs `expire_awaiting_payment()` every
  15 min (cancels unpaid `awaiting_payment` orders older than 30 min, reversing
  any settled rewards). Active.

When the code merges to master it lands on a DB that's already ready.

---

## 2. App Service env vars — the critical step

Add to the App Service configuration (same place `SHIFT_CRON_SECRET`,
`TELEGRAM_*` live). **Use LIVE-mode values, not the test keys in `.env.local`:**

```
CHIP_SECRET_KEY=<Live Mode secret key>
CHIP_PUBLIC_KEY=<Live Mode public key>
CHIP_BRAND_ID=<your Brand ID — same for test & live>
```

- Get Live keys from **portal.chip-in.asia/collect → Developers with Test Mode
  toggled OFF**. Test and live keys are different and NOT interchangeable.
- Confirm `NEXT_PUBLIC_SITE_URL=https://naisecoffee.bizje.my` is set — it drives
  the callback/redirect URLs. Must be the real https domain: the app only sends
  the webhook callback when the site URL is on port 443, so a wrong value
  silently disables the webhook.
- Restart the App Service after adding vars.

---

## 3. CHIP portal — register the webhook

In the CHIP Merchant Portal (Live mode) → Developers → Webhooks, add:

```
URL:   https://naisecoffee.bizje.my/api/payments/chip/webhook
Event: purchase.paid
```

The webhook is signed; the route verifies `X-Signature` against
`CHIP_PUBLIC_KEY`. If the public key is wrong/missing, every webhook is rejected
(the order still confirms via the on-load reconciliation fallback, but you lose
the instant update + Telegram notification).

---

## 4. Ship the code

Per the repo git workflow — open the deploy PR (`development → master`), never
push straight to master:

```bash
git checkout development
git merge feature/payment-integration      # bring the feature into staging
git push origin development                 # land on staging (no PR needed)
# then open the deploy PR:
gh pr create --base master --head development --title "Deploy: CHIP DuitNow QR payments"
```

Merging that PR triggers the production deploy from master.

---

## 5. Post-deploy smoke test (LIVE — real money)

1. Admin → Settings → Payments: turn **Collect DuitNow QR via CHIP** ON, set the
   fee (e.g. flat 0, % 1, min RM0.15, max RM1.50).
2. Place one small real order via DuitNow QR and pay it.
3. Confirm: order flips to paid on the customer side, appears on `/manage`,
   Telegram fires.
4. Check the webhook delivered (CHIP portal → Webhooks → delivery log shows 200).
5. Refund that test order through CHIP if you want to zero it out.

---

## 6. Rollback / kill switch

If something's wrong, set **Collect DuitNow QR via CHIP → OFF** in
Admin → Settings → Payments. DuitNow QR instantly reverts to the manual
static-QR + receipt-upload flow — no redeploy needed.

---

## Known caveat (not yet fixed)

**Cancel-after-paid edge:** if a customer pays and immediately taps Cancel on the
review screen before confirmation lands, the order could be voided while already
paid on CHIP. Far less likely in prod (real QR scanning isn't instant like test
auto-pay, and the webhook closes the window fast), but real. Recommended
hardening before heavy live use: re-check CHIP status inside
`cancelPendingPayment` and refuse/reconcile if the purchase is already paid.

---

## Reference — what the feature added

- **New env:** `CHIP_SECRET_KEY`, `CHIP_PUBLIC_KEY`, `CHIP_BRAND_ID` (server-only).
- **DB:** `orders.gateway_fee`, `orders.pending_voucher_id`;
  `payment_settings.chip_enabled` / `chip_fee_flat` / `chip_fee_percent` /
  `chip_fee_min` / `chip_fee_max`; reuses `chip_purchases` table +
  `awaiting_payment` order status + `expire_awaiting_payment()` fn.
- **Routes:** `POST /api/payments/chip/webhook`; `/checkout/pay/[token]` review
  screen.
- **Flow:** checkout (DuitNow QR + CHIP enabled) → `awaiting_payment` order +
  CHIP purchase → review screen → CHIP hosted QR → webhook flips to paid +
  settles rewards/Telegram; order page reconciles + auto-polls as a backstop.
- **Fee:** `clamp(flat + percent, min, max)`, all sen; percent in basis points;
  0 min/max = no bound.
