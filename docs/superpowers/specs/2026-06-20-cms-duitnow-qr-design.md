# CMS-managed DuitNow QR — Design

**Date:** 2026-06-20
**Status:** Approved

## Problem

The checkout DuitNow QR is a hardcoded static asset. `components/duitnow-qr-card.tsx`
renders `images.qrDuitnow` (`/brand/QRCode.png`, defined in `constants/images.ts`),
and there is no admin field anywhere to manage it. If the merchant's DuitNow QR
changes, it requires a code change + redeploy.

This is the lone holdout: its sibling payment data — the bank-transfer account
details (`bank_name`, `bank_account_number`, `bank_account_holder`) — already lives
in the `payment_settings` table and is edited on `/admin/settings`. The QR should
join it.

## Goal

Make the merchant DuitNow QR uploadable/replaceable from `/admin/settings`, so a QR
change is a CMS edit rather than a code change + redeploy. When no QR has been
uploaded, checkout falls back to the bundled `/brand/QRCode.png` so the card can
never render empty.

## Decisions

- **Fallback:** keep the bundled `/brand/QRCode.png` as the default. Admin upload
  overrides it; clearing it reverts to the bundled asset. Checkout never shows an
  empty/broken QR.
- **Storage:** a new dedicated, public, admin-write `payments` Storage bucket +
  a new `payment_settings.duitnow_qr_url` column. Mirrors the existing `products`
  bucket pattern; keeps the merchant QR separate from catalog images.
- **Admin UI:** generalize the existing `components/admin/image-upload.tsx`
  (`ImageUpload`) — it is the identical UI — rather than building a one-off QR
  uploader.

## Existing patterns this reuses

- **`payment_settings`** (`supabase/migrations/20260620150000_payment_settings.sql`):
  single-row (`id boolean primary key`) table, world-readable, admin-write via
  `current_user_role() = 'admin'`. Read in `lib/settings/payments.ts`, written in
  `app/(admin)/admin/settings/actions.ts:updatePaymentSettings`.
- **`products` Storage bucket**
  (`supabase/migrations/20260619100200_products_storage.sql`): public bucket, 5 MB
  limit, `image/jpeg|png|webp`, `select` public + admin-only `insert/update/delete`.
- **`uploadProductImage`** (`app/(admin)/admin/menu/actions.ts`): admin-gated server
  action that validates size/mime, writes `<uuid>.<ext>` via the service-role client,
  returns `getPublicUrl`.
- **`ImageUpload`** (`components/admin/image-upload.tsx`): client control with a
  thumbnail, Upload/Replace, and Remove, calling `uploadProductImage`.

## Components / changes

### 1. Migration — `supabase/migrations/<ts>_payments_duitnow_qr.sql`

- Create the **`payments`** Storage bucket: public, `file_size_limit` 5242880,
  `allowed_mime_types` `image/jpeg, image/png, image/webp`. Policies:
  `payments_read_public` (select, public), `payments_insert_admin`,
  `payments_update_admin`, `payments_delete_admin` (each gated on
  `bucket_id = 'payments' and public.current_user_role() = 'admin'`). Direct copy
  of the `products` bucket migration with the id/name swapped.
- `alter table public.payment_settings add column duitnow_qr_url text;` — nullable,
  default null. Existing `payment_settings` RLS already governs the row; no policy
  change. No backfill.

### 2. Generated types — `types/database.ts`

Add `duitnow_qr_url: string | null` (Row), `duitnow_qr_url?: string | null`
(Insert), `duitnow_qr_url?: string | null` (Update) to the `payment_settings`
table type. Either hand-edit or regenerate, as long as it appears in all three.

### 3. Settings domain — `lib/settings/payments.ts`

- `PaymentSettings` gains a top-level `duitnowQrUrl: string | null` (beside `bank`).
- `DEFAULT_PAYMENT_SETTINGS.duitnowQrUrl = null`.
- `Row` gains `duitnow_qr_url: string | null`; `COLUMNS` gains `duitnow_qr_url`;
  `map()` sets `duitnowQrUrl: row.duitnow_qr_url`.

### 4. Upload + persist — `app/(admin)/admin/settings/actions.ts`

- New `uploadDuitnowQr(formData): Promise<{ ok: true; url: string } | { ok: false; error: string }>`
  — a near-copy of `uploadProductImage`: admin-gated, same 5 MB / mime validation,
  writes `<uuid>.<ext>` to the **`payments`** bucket via the service-role client,
  returns the public URL.
- `updatePaymentSettings` persists `duitnow_qr_url: input.duitnowQrUrl` (empty/blank
  normalized to `null`). It already `revalidatePath`s `/checkout` and
  `/admin/settings`.

### 5. Admin UI — `components/admin/image-upload.tsx` + `payment-settings-form.tsx`

- Generalize `ImageUpload` with two optional props (defaults preserve current
  behavior so the product form is untouched):
  - `upload?: (fd: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>`
    — defaults to `uploadProductImage`.
  - `placeholder?: string` — defaults to `images.coffeeWithLogo`.
- In `PaymentSettingsForm`, under the **QR category** block (`cat.id === "qr"`,
  mirroring how the bank details hang under the `bank` category via
  `cat.id === "bank"`), render
  `ImageUpload` with `upload={uploadDuitnowQr}`, `placeholder={images.qrDuitnow}`,
  `value={s.duitnowQrUrl}`, `onChange={(url) => setS({ ...s, duitnowQrUrl: url })}`,
  plus a short caption: "Shown at checkout when DuitNow QR is selected."

### 6. Checkout render — `duitnow-qr-card.tsx` + `checkout-screen.tsx`

- `DuitnowQrCard` accepts `src?: string`; `const QR_SRC = src ?? images.qrDuitnow;`
  (bundled fallback preserved). The save-to-device `fetch(QR_SRC)` works for the
  Supabase public URL — public-bucket objects send `Access-Control-Allow-Origin: *`.
- `checkout-screen.tsx` passes the URL it already receives server-side:
  `<DuitnowQrCard src={payments.duitnowQrUrl ?? undefined} />`.

### 7. Keep the bundled asset

`constants/images.ts` `qrDuitnow` and `public/brand/QRCode.png` stay — they are the
default fallback, no longer the only source.

## Data flow

1. Admin uploads a QR on `/admin/settings` → `uploadDuitnowQr` stores it in the
   `payments` bucket → returns public URL → held in form state.
2. Admin clicks Save payments → `updatePaymentSettings` writes `duitnow_qr_url` to
   `payment_settings` → revalidates `/checkout`.
3. Checkout server reads `payments` via `getPaymentSettings()` → passes
   `duitnowQrUrl` to `DuitnowQrCard`.
4. `DuitnowQrCard` renders the uploaded URL, or `images.qrDuitnow` when null.

## Error handling

- Upload validates size (≤5 MB) and mime (jpeg/png/webp) client-side and in the
  action; the bucket enforces the same limits server-side.
- `getPaymentSettings` already FAILS OPEN to `DEFAULT_PAYMENT_SETTINGS`
  (`duitnowQrUrl: null`), so a transient read failure shows the bundled QR — never
  a broken card.
- `updatePaymentSettings` returns `{ ok: false, error }` surfaced inline by the
  form, as today.

## Testing (manual; no automated harness)

Per task: `npx tsc --noEmit` and `npm run lint`. End to end:
1. Fresh / no upload → checkout DuitNow shows the bundled `/brand/QRCode.png`.
2. Upload a QR on `/admin/settings`, Save → checkout DuitNow shows the uploaded
   image; "Save to device" downloads/saves it.
3. Replace the QR → checkout reflects the new image after save.
4. Remove the QR (clear) + Save → checkout reverts to the bundled QR.
5. Non-image / >5 MB upload → inline error, nothing saved.
6. Confirm the product image upload still works (generalized `ImageUpload`
   regression check).

## Out of scope (YAGNI)

- Deleting superseded QR objects from storage on replace (orphans are cheap;
  product images don't garbage-collect either).
- Multiple QRs or per-outlet QRs.
- Changing `next.config` `images.remotePatterns` — the Supabase domain is already
  allowed (product images render remotely). Verified during planning.
