# CMS-managed DuitNow QR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the checkout DuitNow QR uploadable/replaceable from `/admin/settings` instead of a hardcoded asset, falling back to the bundled `/brand/QRCode.png` when none is set.

**Architecture:** The QR is one merchant-wide image, so it joins the bank-transfer details already in the single-row `payment_settings` table as a new `duitnow_qr_url` column. The image lives in a new public, admin-write `payments` Storage bucket (a copy of the `products` bucket). Admin uploads via the existing `ImageUpload` control (generalized to take any upload action + placeholder); checkout passes the stored URL into `DuitnowQrCard`, which renders it or the bundled fallback.

**Tech Stack:** Next.js 16 (App Router) + React 19, TypeScript (strict), Tailwind, Supabase (Postgres + Storage + RLS), shadcn/ui, lucide-react.

## Global Constraints

- **No new dependencies.** Use only what's already in `package.json`.
- **TypeScript strict, no `any`.** Every change must pass `npx tsc --noEmit`.
- **No automated test harness exists.** Verification per task = `npx tsc --noEmit`, `npm run lint` (for files with logic/JSX), plus the manual checks stated in the task. Task 7 is the full manual pass.
- **Never expose the service-role key to the client.** Storage writes go through admin-gated server actions using `createAdminClient()` (server-only).
- **Storage bucket limits mirror `products`:** public bucket, 5 MB (`5242880`), `image/jpeg, image/png, image/webp`, admin-only write.
- **Fallback is the bundled asset.** When `duitnow_qr_url` is null, checkout shows `images.qrDuitnow` (`/brand/QRCode.png`). The bundled asset and its `constants/images.ts` entry stay.
- **`payment_settings` is a single row** keyed `id = true`; reads FAIL OPEN to `DEFAULT_PAYMENT_SETTINGS`.
- Commit after every task with the message shown. The current branch is `dev`; commit there.

---

### Task 1: Migration — `payments` bucket + `duitnow_qr_url` column

**Files:**
- Create: `supabase/migrations/20260620160000_payments_duitnow_qr.sql`

**Interfaces:**
- Consumes: existing `public.payment_settings` table, `public.current_user_role()`.
- Produces: a `payments` Storage bucket (public, admin-write) and `payment_settings.duitnow_qr_url text` (nullable).

- [ ] **Step 1: Create the migration**

File: `supabase/migrations/20260620160000_payments_duitnow_qr.sql`

```sql
-- Make the merchant DuitNow QR CMS-managed. Two parts:
--   1) a public, admin-write `payments` Storage bucket for the QR image
--      (a copy of the `products` bucket policy set), and
--   2) a `duitnow_qr_url` column on the single-row payment_settings table.
-- When the column is null the storefront falls back to the bundled QR asset.
-- payment_settings RLS already governs the row, so no table policy change.

-- 1) Storage bucket for payment images (currently just the DuitNow QR). Public
-- (the QR renders at checkout without auth), capped at 5 MB, images only.
-- Path convention: "<uuid>.<ext>". Only admins may write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payments', 'payments', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "payments_read_public" on storage.objects for select
  using (bucket_id = 'payments');

create policy "payments_insert_admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'payments' and public.current_user_role() = 'admin');

create policy "payments_update_admin" on storage.objects for update to authenticated
  using (bucket_id = 'payments' and public.current_user_role() = 'admin');

create policy "payments_delete_admin" on storage.objects for delete to authenticated
  using (bucket_id = 'payments' and public.current_user_role() = 'admin');

-- 2) The QR image URL on the single payment_settings row. Nullable; null means
-- "use the bundled fallback". No backfill.
alter table public.payment_settings
  add column duitnow_qr_url text;

comment on column public.payment_settings.duitnow_qr_url is
  'Public URL of the merchant DuitNow QR in the payments bucket. Null = use the bundled fallback asset.';
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (name: `payments_duitnow_qr`, the SQL above), or `supabase db push` if using the CLI. Confirm the column and bucket exist:

```sql
select column_name from information_schema.columns
  where table_name = 'payment_settings' and column_name = 'duitnow_qr_url';
select id from storage.buckets where id = 'payments';
```
Expected: one row each (`duitnow_qr_url`; `payments`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260620160000_payments_duitnow_qr.sql
git commit -m "feat(payments): add payments storage bucket + duitnow_qr_url column"
```

---

### Task 2: Generated types — `payment_settings.duitnow_qr_url`

**Files:**
- Modify: `types/database.ts` (the `payment_settings` `Row`/`Insert`/`Update` blocks, near line 288)

**Interfaces:**
- Consumes: the column from Task 1.
- Produces: `Tables<"payment_settings">` gains `duitnow_qr_url: string | null`.

- [ ] **Step 1: Add the field to all three blocks**

In `types/database.ts`, inside the `payment_settings` table type, add the column to `Row`, `Insert`, and `Update`. Place it near the other `bank_*` text columns; exact position is not significant.

In `Row`:

```ts
          duitnow_qr_url: string | null
```

In `Insert`:

```ts
          duitnow_qr_url?: string | null
```

In `Update`:

```ts
          duitnow_qr_url?: string | null
```

(If you prefer, regenerate the whole file with `supabase gen types typescript` instead of hand-editing — either is fine as long as `duitnow_qr_url` appears in all three blocks.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(payments): add duitnow_qr_url to generated types"
```

---

### Task 3: Settings domain — carry `duitnowQrUrl`

**Files:**
- Modify: `lib/settings/payments.ts`

**Interfaces:**
- Consumes: `Tables<"payment_settings">.duitnow_qr_url` (Task 2).
- Produces: `PaymentSettings.duitnowQrUrl: string | null`; read back by `getPaymentSettings`; default `null`.

- [ ] **Step 1: Add the field to the `PaymentSettings` type**

In `lib/settings/payments.ts`, in the `PaymentSettings` type, add a top-level field after `bank: BankDetails;`:

```ts
  // Public URL of the uploaded DuitNow QR; null = use the bundled fallback.
  duitnowQrUrl: string | null;
```

- [ ] **Step 2: Default it to null**

In `DEFAULT_PAYMENT_SETTINGS`, add after the `bank: { … }` line:

```ts
  duitnowQrUrl: null,
```

- [ ] **Step 3: Add it to the `Row` type and `COLUMNS`**

In the `Row` type, add after `bank_account_holder: string;`:

```ts
  duitnow_qr_url: string | null;
```

Change the `COLUMNS` constant's final segment so the column is fetched. Replace:

```ts
  "bank_name, bank_account_number, bank_account_holder";
```

with:

```ts
  "bank_name, bank_account_number, bank_account_holder, duitnow_qr_url";
```

- [ ] **Step 4: Map it**

In `map()`, add after the `bank: { … }` block (after the closing `},`):

```ts
    duitnowQrUrl: row.duitnow_qr_url,
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/settings/payments.ts
git commit -m "feat(payments): thread duitnowQrUrl through settings domain"
```

---

### Task 4: Upload action + persist the URL

**Files:**
- Modify: `app/(admin)/admin/settings/actions.ts`

**Interfaces:**
- Consumes: `PaymentSettings.duitnowQrUrl` (Task 3), `createAdminClient` from `@/lib/supabase/admin`, `isAdmin` (already imported).
- Produces:
  - `uploadDuitnowQr(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }>`.
  - `updatePaymentSettings` now persists `duitnow_qr_url`.

- [ ] **Step 1: Import the admin client**

At the top of `app/(admin)/admin/settings/actions.ts`, add after the `createClient` import:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
```

- [ ] **Step 2: Persist `duitnow_qr_url` in `updatePaymentSettings`**

In the `.from("payment_settings").update({ … })` object, add after `bank_account_holder: input.bank.accountHolder.trim(),`:

```ts
      // Empty/blank normalizes to null so checkout falls back to the bundled QR.
      duitnow_qr_url: input.duitnowQrUrl?.trim() ? input.duitnowQrUrl.trim() : null,
```

- [ ] **Step 3: Add the `uploadDuitnowQr` action**

At the end of the file, add (a near-copy of `uploadProductImage`, writing to the `payments` bucket):

```ts
// Upload the merchant DuitNow QR to the public `payments` bucket and return its
// URL. Uses the service-role client so the write succeeds regardless of cookie
// propagation; the action is admin-gated above. Mirrors uploadProductImage.
export async function uploadDuitnowQr(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "No file." };
  if (file.size > 5_242_880) return { ok: false, error: "Image must be under 5 MB." };
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type))
    return { ok: false, error: "Only JPEG, PNG, and WebP images are allowed." };

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const db = createAdminClient();
  const { error } = await db.storage
    .from("payments")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data } = db.storage.from("payments").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/settings/actions.ts"
git commit -m "feat(payments): uploadDuitnowQr action + persist duitnow_qr_url"
```

---

### Task 5: Generalize `ImageUpload` + add the QR field to the payments form

**Files:**
- Modify: `components/admin/image-upload.tsx`
- Modify: `components/admin/payment-settings-form.tsx`

**Interfaces:**
- Consumes: `uploadDuitnowQr` (Task 4), `PaymentSettings.duitnowQrUrl` (Task 3), `images.qrDuitnow`.
- Produces: an `ImageUpload` that accepts an optional `upload` action and `placeholder`; a QR upload control under the QR category in `PaymentSettingsForm`.

- [ ] **Step 1: Generalize `ImageUpload` props (backward-compatible)**

In `components/admin/image-upload.tsx`, replace the props block:

```ts
export function ImageUpload({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
```

with:

```ts
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

export function ImageUpload({
  value,
  onChange,
  upload = uploadProductImage,
  placeholder = images.coffeeWithLogo,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  // Server action that stores the file and returns its public URL. Defaults to
  // the product-image uploader so existing callers are unaffected.
  upload?: (formData: FormData) => Promise<UploadResult>;
  // Thumbnail shown when `value` is null.
  placeholder?: string;
}) {
```

- [ ] **Step 2: Use the `upload` prop and `placeholder`**

In `onPick`, change the call `await uploadProductImage(fd)` to:

```ts
        const res = await upload(fd);
```

In the JSX thumbnail, change `src={value ?? images.coffeeWithLogo}` to:

```ts
          src={value ?? placeholder}
```

(The `uploadProductImage` and `images` imports stay — they are now the default values.)

- [ ] **Step 3: Wire a QR upload control into the payments form**

In `components/admin/payment-settings-form.tsx`, add imports after the existing ones:

```ts
import { ImageUpload } from "@/components/admin/image-upload";
import { images } from "@/constants/images";
import { uploadDuitnowQr } from "@/app/(admin)/admin/settings/actions";
```

(Note: `updatePaymentSettings` is already imported from the same actions module; add `uploadDuitnowQr` to that line instead of a second import if you prefer — either compiles.)

Then, inside the category `.map((cat) => { … })`, directly after the existing `{cat.id === "bank" && ( … )}` block and before the closing `</div>` of the category card, add a QR block:

```tsx
            {cat.id === "qr" && (
              <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold">DuitNow QR image</span>
                  <span className="text-xs text-muted-foreground">
                    Shown at checkout when DuitNow QR is selected. Leave empty to
                    use the built-in QR.
                  </span>
                </div>
                <ImageUpload
                  value={s.duitnowQrUrl}
                  onChange={(url) => setS({ ...s, duitnowQrUrl: url })}
                  upload={uploadDuitnowQr}
                  placeholder={images.qrDuitnow}
                />
              </div>
            )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Manual check**

`npm run dev`, open `/admin/settings`:
- Under the **QR Code** category there's a "DuitNow QR image" control showing the bundled QR as placeholder.
- Upload a PNG/JPEG → thumbnail updates → click **Save payments** → "Saved."
- Reload → the uploaded QR persists (thumbnail still shows it).
- Click **Remove** → Save → reload → placeholder (bundled QR) shows again.
- The product image upload on `/admin/menu` (create/edit a product) still works unchanged.

- [ ] **Step 6: Commit**

```bash
git add components/admin/image-upload.tsx components/admin/payment-settings-form.tsx
git commit -m "feat(admin): generalize ImageUpload + add DuitNow QR upload to payments settings"
```

---

### Task 6: Render the CMS QR at checkout

**Files:**
- Modify: `components/duitnow-qr-card.tsx`
- Modify: `components/checkout-screen.tsx`
- Modify: `app/(customer)/checkout/page.tsx`

**Interfaces:**
- Consumes: `PaymentSettings.duitnowQrUrl` (Task 3) — already fetched in `checkout/page.tsx` as `payments`.
- Produces: `DuitnowQrCard` accepts `src?: string` and renders it, falling back to `images.qrDuitnow`; `CheckoutScreen` gains a `duitnowQrUrl: string | null` prop.

Wiring note: `CheckoutScreen` does **not** receive the whole `PaymentSettings`; the page passes `bank={payments.bank}` as a discrete prop. Thread the QR URL the same way — a new `duitnowQrUrl` prop on `CheckoutScreen`, supplied from `payments.duitnowQrUrl` in the page.

- [ ] **Step 1: Add a `src` prop to `DuitnowQrCard`**

In `components/duitnow-qr-card.tsx`, replace:

```tsx
export function DuitnowQrCard() {
```

with:

```tsx
// `src` is the CMS-uploaded QR URL; when absent we fall back to the bundled
// asset so the card never renders empty.
export function DuitnowQrCard({ src }: { src?: string }) {
```

Then replace the module-level constant:

```tsx
const QR_SRC = images.qrDuitnow;
```

with a per-render value computed inside the component. Delete that top-level `const QR_SRC = images.qrDuitnow;` line, and add as the first line inside the component body (before `const [saving, setSaving] = useState(false);`):

```tsx
  const QR_SRC = src ?? images.qrDuitnow;
```

(`SAVE_FILENAME` stays at module scope. `images` import stays — it's the fallback. The rest of the component is unchanged: `saveToDevice` fetches `QR_SRC`, which now works for a Supabase public URL.)

- [ ] **Step 2: Add a `duitnowQrUrl` prop to `CheckoutScreen`**

In `components/checkout-screen.tsx`, the component destructures props with `closedMessage`, `methods`, `bank` and types them inline. Add the new prop in both places.

In the destructure (after `bank,`):

```tsx
  duitnowQrUrl,
```

In the props type (after `bank: BankDetails;`):

```tsx
  duitnowQrUrl: string | null;
```

Then change the QR render in the `{selected === "duitnow-qr" && ( … )}` block:

```tsx
            <DuitnowQrCard />
```

to:

```tsx
            <DuitnowQrCard src={duitnowQrUrl ?? undefined} />
```

- [ ] **Step 3: Pass the URL from the page**

In `app/(customer)/checkout/page.tsx`, the page already fetches `payments` and renders `<CheckoutScreen … bank={payments.bank} />`. Add the new prop after `bank={payments.bank}`:

```tsx
      duitnowQrUrl={payments.duitnowQrUrl}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Manual check**

`npm run dev`, go to `/checkout` with items in the cart, select **DuitNow QR**:
- With no QR uploaded (or after Remove): the bundled `/brand/QRCode.png` shows; "Save to device" works.
- After uploading a QR in `/admin/settings` and saving: the checkout QR is the uploaded image; "Save to device" downloads/saves that image (no CORS error in console).

- [ ] **Step 6: Commit**

```bash
git add components/duitnow-qr-card.tsx components/checkout-screen.tsx "app/(customer)/checkout/page.tsx"
git commit -m "feat(checkout): render CMS-managed DuitNow QR with bundled fallback"
```

---

### Task 7: Full manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: build succeeds (type + lint clean).

- [ ] **Step 2: Walk the end-to-end matrix** (`npm run dev`)

1. Fresh state (no `duitnow_qr_url`): `/checkout` → DuitNow QR shows the bundled `/brand/QRCode.png`.
2. `/admin/settings` → QR Code category → upload a PNG → Save payments → "Saved."
3. `/checkout` → DuitNow QR now shows the uploaded image; "Save to device" saves/downloads it; no console CORS error.
4. `/admin/settings` → upload a different image → Save → `/checkout` reflects the new QR.
5. `/admin/settings` → Remove → Save → `/checkout` reverts to the bundled QR.
6. `/admin/settings` → try a >5 MB file and a non-image (e.g. `.pdf` renamed) → inline error, nothing saved.
7. `/admin/menu` → create/edit a product → image upload still works (generalized `ImageUpload` regression).

- [ ] **Step 3: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "test(cms-duitnow-qr): manual verification pass" --allow-empty
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** migration/bucket + column (T1), generated types (T2), settings domain `duitnowQrUrl` (T3), upload action + persist (T4), generalized `ImageUpload` + admin field (T5), checkout render + fallback (T6), manual matrix (T7). Every spec section maps to a task. `next.config` `remotePatterns` already allows the Supabase host at `/storage/v1/**` — no change needed (verified).
- **Type consistency:** the new column is `duitnow_qr_url` everywhere in SQL/DB types (T1–T2); the domain field is `duitnowQrUrl` (camelCase) in `PaymentSettings`, `DEFAULT_PAYMENT_SETTINGS`, `map()`, the form state, the action input, and the `DuitnowQrCard` `src` source (T3–T6). The only new function is `uploadDuitnowQr` with the signature defined in Task 4 and consumed in Task 5.
- **Order of work matters:** T1→T2→T3 (data) precede T4 (action, needs the type) and T5 (UI, needs the action + field). T6 needs T3 (field on the screen's payment data). T1 must be applied before the manual checks in T5–T7.
- **Backward compatibility:** `ImageUpload`'s new props default to the product-image behavior, so the `/admin/menu` product form is untouched.
