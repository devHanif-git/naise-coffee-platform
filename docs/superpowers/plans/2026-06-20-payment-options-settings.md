# Payment Options Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin enable/disable payment methods (per-category master + per-method) from `/admin/settings`, add an admin-configured Bank Transfer method, and have checkout offer only the enabled methods.

**Architecture:** The payment-method *catalog* stays code-owned in `data/payment-methods.ts` (each method has bespoke checkout behavior). A new single-row `payment_settings` table stores only on/off state (per category + per method) and bank account details, mirroring the existing `store_settings` pattern. Checkout reads the settings server-side, filters the catalog to effectively-enabled methods, and passes them into `CheckoutScreen`.

**Tech Stack:** Next.js (App Router, Server Components + server actions), TypeScript (strict), Tailwind, shadcn/ui (`Switch`, `Input`, `Label`), Supabase (Postgres + RLS), lucide-react icons.

## Global Constraints

- **No new libraries** — use what's installed (CLAUDE.md). No test framework exists; verification is `npm run lint`, `npx tsc --noEmit`, `npm run build`, plus manual checks.
- **TypeScript strict, no `any`.** Money is stored in sen; format with `formatPrice` from `lib/format`.
- **Migrations** live in `supabase/migrations/` and are applied via the Supabase MCP `apply_migration` tool. Reuse `public.set_updated_at()` and `public.current_user_role()`.
- **RLS:** every data table is world-readable only where intended; `payment_settings` is read-all, admin-write — copy the `store_settings` policy shape exactly.
- **Secrets:** never expose service-role key; privileged writes go through the server action guarded by `isAdmin()` (from `lib/auth/session`) and RLS.
- **Fail-open** on payment-settings read errors (degrade to all-enabled). This is deliberate and opposite to store-closure (which fails closed).
- **Effective availability** of a method = `settings.categories[method.category] && settings.methods[method.id]`.

---

### Task 1: `payment_settings` table + RLS + seed

**Files:**
- Create: `supabase/migrations/20260620150000_payment_settings.sql`

**Interfaces:**
- Produces: table `public.payment_settings` (single row, `id boolean pk default true`) with columns:
  category flags `cash_enabled, qr_enabled, card_enabled, ewallet_enabled, bank_enabled`;
  method flags `cash_method_enabled, duitnow_qr_enabled, apple_pay_enabled, google_pay_enabled, tng_ewallet_enabled, boost_enabled, grabpay_enabled, bank_transfer_enabled`;
  bank text `bank_name, bank_account_number, bank_account_holder`. All flags `boolean not null default true`; bank text `not null default ''`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260620150000_payment_settings.sql`:

```sql
-- Payment settings: a single-row table (boolean PK) holding the on/off state for
-- payment categories and individual methods, plus bank-transfer account details.
-- World-readable (storefront + CMS read it); admin writes. Mirrors store_settings.
-- Reuses public.set_updated_at() and public.current_user_role(). The method/category
-- catalog itself lives in code (data/payment-methods.ts) — this table stores only state.

create table public.payment_settings (
  id                    boolean primary key default true check (id),

  -- Category master switches.
  cash_enabled          boolean not null default true,
  qr_enabled            boolean not null default true,
  card_enabled          boolean not null default true,
  ewallet_enabled       boolean not null default true,
  bank_enabled          boolean not null default true,

  -- Individual method switches.
  cash_method_enabled   boolean not null default true,
  duitnow_qr_enabled    boolean not null default true,
  apple_pay_enabled     boolean not null default true,
  google_pay_enabled    boolean not null default true,
  tng_ewallet_enabled   boolean not null default true,
  boost_enabled         boolean not null default true,
  grabpay_enabled       boolean not null default true,
  bank_transfer_enabled boolean not null default true,

  -- Bank Transfer account details, shown at checkout when Bank Transfer is selected.
  bank_name             text not null default '',
  bank_account_number   text not null default '',
  bank_account_holder   text not null default '',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.payment_settings is 'Single-row payment settings: per-category + per-method enable flags and bank-transfer details. World-readable; admin-write.';

create trigger payment_settings_set_updated_at before update on public.payment_settings
  for each row execute function public.set_updated_at();

alter table public.payment_settings enable row level security;

create policy "payment_settings_read_all" on public.payment_settings for select
  to anon, authenticated using (true);
create policy "payment_settings_write_admin" on public.payment_settings for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- Seed the single row with defaults (everything enabled, bank fields empty).
insert into public.payment_settings (id) values (true) on conflict (id) do nothing;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool with name `payment_settings` and the SQL above (or run it against the database). 

- [ ] **Step 3: Verify the table and seed row exist**

Run a query (via `mcp__supabase__execute_sql`):
```sql
select id, cash_enabled, bank_transfer_enabled, bank_name from public.payment_settings;
```
Expected: exactly one row, `id = true`, `cash_enabled = true`, `bank_transfer_enabled = true`, `bank_name = ''`.

- [ ] **Step 4: Verify RLS is enabled**

Run:
```sql
select relrowsecurity from pg_class where relname = 'payment_settings';
```
Expected: `relrowsecurity = true`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260620150000_payment_settings.sql
git commit -m "feat(db): payment_settings table with per-category/method flags + bank details"
```

---

### Task 2: Types + catalog (add Bank Transfer, categories)

**Files:**
- Modify: `types/payment.ts`
- Modify: `data/payment-methods.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PaymentMethodId` now includes `"bank-transfer"`.
  - `type PaymentCategoryId = "cash" | "qr" | "card" | "ewallet" | "bank"`.
  - `type PaymentMethod` gains `category: PaymentCategoryId`.
  - `type PaymentCategory = { id: PaymentCategoryId; label: string }`.
  - `paymentCategories: PaymentCategory[]` (display order).
  - `paymentMethods: PaymentMethod[]` (each tagged with `category`, plus a `bank-transfer` entry).
  - `defaultPaymentMethodId` stays exported (still `"cash"`).

- [ ] **Step 1: Replace `types/payment.ts`**

```ts
// Payment options offered at checkout. Cash and DuitNow QR are the everyday
// choices, so they are flagged `featured` to surface them above the wallets.
export type PaymentMethodId =
  | "cash"
  | "duitnow-qr"
  | "apple-pay"
  | "google-pay"
  | "tng-ewallet"
  | "boost"
  | "grabpay"
  | "bank-transfer";

// Methods are grouped into these categories for admin enable/disable controls.
export type PaymentCategoryId = "cash" | "qr" | "card" | "ewallet" | "bank";

export type PaymentMethod = {
  id: PaymentMethodId;
  // The category this method belongs to (drives the admin grouping and the
  // category master switch).
  category: PaymentCategoryId;
  name: string;
  // Short helper line shown under the name.
  description: string;
  // Featured methods render as large cards at the top of the selector.
  featured?: boolean;
  // Methods only available to signed-in members. Cash (pay-at-counter) is
  // gated this way — guests must use a prepaid method or sign in. Selecting a
  // gated method as a guest prompts sign-in rather than placing the order.
  requiresAuth?: boolean;
};

export type PaymentCategory = {
  id: PaymentCategoryId;
  label: string;
};
```

- [ ] **Step 2: Replace `data/payment-methods.ts`**

```ts
import type { PaymentCategory, PaymentMethod } from "@/types/payment";

// Categories in display order — used for the admin grouping and ordering.
export const paymentCategories: PaymentCategory[] = [
  { id: "cash", label: "Cash" },
  { id: "qr", label: "QR Code" },
  { id: "card", label: "Card" },
  { id: "ewallet", label: "E-Wallet" },
  { id: "bank", label: "Bank" },
];

// Order matters: featured methods (Cash, DuitNow QR) come first so the selector
// can render them as the prominent cards. Icons are mapped in the UI layer to
// keep this file pure content.
export const paymentMethods: PaymentMethod[] = [
  {
    id: "cash",
    category: "cash",
    name: "Cash",
    description: "Pay at the counter on pickup",
    featured: true,
    requiresAuth: true,
  },
  {
    id: "duitnow-qr",
    category: "qr",
    name: "DuitNow QR",
    description: "Scan with any bank app",
    featured: true,
  },
  {
    id: "apple-pay",
    category: "card",
    name: "Apple Pay",
    description: "Pay with Apple Pay",
  },
  {
    id: "google-pay",
    category: "card",
    name: "Google Pay",
    description: "Pay with Google Pay",
  },
  {
    id: "tng-ewallet",
    category: "ewallet",
    name: "Touch 'n Go eWallet",
    description: "Pay with your TNG balance",
  },
  {
    id: "boost",
    category: "ewallet",
    name: "Boost",
    description: "Pay with Boost",
  },
  {
    id: "grabpay",
    category: "ewallet",
    name: "GrabPay",
    description: "Pay with GrabPay",
  },
  {
    // Bank Transfer is prepaid (customer transfers before/at order), so unlike
    // Cash it does NOT require auth — guests can use it.
    id: "bank-transfer",
    category: "bank",
    name: "Bank Transfer",
    description: "Transfer to our bank account",
  },
];

// The method selected by default when none of the enabled methods dictates
// otherwise. Checkout falls back to the first enabled method at runtime.
export const defaultPaymentMethodId: PaymentMethod["id"] = "cash";
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). Note: `components/checkout-screen.tsx` will report a missing `bank-transfer` key in its `methodIcons` `Record<PaymentMethodId, LucideIcon>` — that is fixed in Task 6. If you run tasks in order, this error is expected here and resolved in Task 6. To keep this task green in isolation, you may proceed; the build gate is enforced at Task 6.

- [ ] **Step 4: Commit**

```bash
git add types/payment.ts data/payment-methods.ts
git commit -m "feat(payments): add categories and Bank Transfer method to catalog"
```

---

### Task 3: Settings read helper `lib/settings/payments.ts`

**Files:**
- Create: `lib/settings/payments.ts`

**Interfaces:**
- Consumes: `paymentMethods` from `data/payment-methods.ts`; `PaymentMethod`, `PaymentMethodId`, `PaymentCategoryId` from `types/payment.ts`; `createClient` from `lib/supabase/server`.
- Produces:
  - `type BankDetails = { name: string; accountNumber: string; accountHolder: string }`.
  - `type PaymentSettings = { categories: Record<PaymentCategoryId, boolean>; methods: Record<PaymentMethodId, boolean>; bank: BankDetails }`.
  - `const DEFAULT_PAYMENT_SETTINGS: PaymentSettings` (all true, empty bank).
  - `async function getPaymentSettings(): Promise<PaymentSettings>` (fail-open).
  - `function getEnabledPaymentMethods(settings: PaymentSettings): PaymentMethod[]`.

- [ ] **Step 1: Create `lib/settings/payments.ts`**

```ts
import { createClient } from "@/lib/supabase/server";
import { paymentMethods } from "@/data/payment-methods";
import type { PaymentCategoryId, PaymentMethod, PaymentMethodId } from "@/types/payment";

export type BankDetails = {
  name: string;
  accountNumber: string;
  accountHolder: string;
};

// On/off state for every category and method, plus the bank-transfer account
// details. The catalog (names/order/behavior) stays in data/payment-methods.ts;
// this only carries state.
export type PaymentSettings = {
  categories: Record<PaymentCategoryId, boolean>;
  methods: Record<PaymentMethodId, boolean>;
  bank: BankDetails;
};

// Safe defaults if the row is missing or unreadable. Payment config FAILS OPEN
// (everything enabled) so a transient read failure never blocks checkout —
// deliberately the opposite of store-closure, which fails closed.
export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  categories: { cash: true, qr: true, card: true, ewallet: true, bank: true },
  methods: {
    cash: true,
    "duitnow-qr": true,
    "apple-pay": true,
    "google-pay": true,
    "tng-ewallet": true,
    boost: true,
    grabpay: true,
    "bank-transfer": true,
  },
  bank: { name: "", accountNumber: "", accountHolder: "" },
};

type Row = {
  cash_enabled: boolean;
  qr_enabled: boolean;
  card_enabled: boolean;
  ewallet_enabled: boolean;
  bank_enabled: boolean;
  cash_method_enabled: boolean;
  duitnow_qr_enabled: boolean;
  apple_pay_enabled: boolean;
  google_pay_enabled: boolean;
  tng_ewallet_enabled: boolean;
  boost_enabled: boolean;
  grabpay_enabled: boolean;
  bank_transfer_enabled: boolean;
  bank_name: string;
  bank_account_number: string;
  bank_account_holder: string;
};

const COLUMNS =
  "cash_enabled, qr_enabled, card_enabled, ewallet_enabled, bank_enabled, " +
  "cash_method_enabled, duitnow_qr_enabled, apple_pay_enabled, google_pay_enabled, " +
  "tng_ewallet_enabled, boost_enabled, grabpay_enabled, bank_transfer_enabled, " +
  "bank_name, bank_account_number, bank_account_holder";

function map(row: Row): PaymentSettings {
  return {
    categories: {
      cash: row.cash_enabled,
      qr: row.qr_enabled,
      card: row.card_enabled,
      ewallet: row.ewallet_enabled,
      bank: row.bank_enabled,
    },
    methods: {
      cash: row.cash_method_enabled,
      "duitnow-qr": row.duitnow_qr_enabled,
      "apple-pay": row.apple_pay_enabled,
      "google-pay": row.google_pay_enabled,
      "tng-ewallet": row.tng_ewallet_enabled,
      boost: row.boost_enabled,
      grabpay: row.grabpay_enabled,
      "bank-transfer": row.bank_transfer_enabled,
    },
    bank: {
      name: row.bank_name,
      accountNumber: row.bank_account_number,
      accountHolder: row.bank_account_holder,
    },
  };
}

// FAIL-OPEN: any read error or missing row degrades to DEFAULT_PAYMENT_SETTINGS
// (everything enabled), so a transient read/RLS glitch never blocks ordering.
export async function getPaymentSettings(): Promise<PaymentSettings> {
  const db = await createClient();
  const { data, error } = await db
    .from("payment_settings")
    .select(COLUMNS)
    .limit(1)
    .maybeSingle();
  if (error || !data) return DEFAULT_PAYMENT_SETTINGS;
  return map(data as Row);
}

// The ordered list of methods the customer may actually pick: enabled at BOTH
// the category and the method level. Preserves catalog order.
export function getEnabledPaymentMethods(settings: PaymentSettings): PaymentMethod[] {
  return paymentMethods.filter(
    (m) => settings.categories[m.category] && settings.methods[m.id],
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors from this file (the Task 6 `methodIcons` error may still show until Task 6 — that is the only expected outstanding error).

- [ ] **Step 3: Commit**

```bash
git add lib/settings/payments.ts
git commit -m "feat(payments): payment settings read helper (fail-open) + enabled-method filter"
```

---

### Task 4: `updatePaymentSettings` server action

**Files:**
- Modify: `app/(admin)/admin/settings/actions.ts`

**Interfaces:**
- Consumes: `PaymentSettings` from `lib/settings/payments`; existing `ActionResult`, `isAdmin`, `createClient`, `revalidatePath` already imported in this file.
- Produces: `async function updatePaymentSettings(input: PaymentSettings): Promise<ActionResult>`.

- [ ] **Step 1: Add the import**

At the top of `app/(admin)/admin/settings/actions.ts`, below the existing `import type { StoreSettings } ...` line, add:

```ts
import type { PaymentSettings } from "@/lib/settings/payments";
```

- [ ] **Step 2: Append the action**

At the end of `app/(admin)/admin/settings/actions.ts`, add:

```ts
export async function updatePaymentSettings(input: PaymentSettings): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  const db = await createClient();
  const { data, error } = await db
    .from("payment_settings")
    .update({
      cash_enabled: input.categories.cash,
      qr_enabled: input.categories.qr,
      card_enabled: input.categories.card,
      ewallet_enabled: input.categories.ewallet,
      bank_enabled: input.categories.bank,
      cash_method_enabled: input.methods.cash,
      duitnow_qr_enabled: input.methods["duitnow-qr"],
      apple_pay_enabled: input.methods["apple-pay"],
      google_pay_enabled: input.methods["google-pay"],
      tng_ewallet_enabled: input.methods["tng-ewallet"],
      boost_enabled: input.methods.boost,
      grabpay_enabled: input.methods.grabpay,
      bank_transfer_enabled: input.methods["bank-transfer"],
      bank_name: input.bank.name.trim(),
      bank_account_number: input.bank.accountNumber.trim(),
      bank_account_holder: input.bank.accountHolder.trim(),
    })
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Payment settings row is missing." };

  // Revalidate the CMS settings page and checkout, where the enabled-method
  // list and bank details are read.
  revalidatePath("/admin/settings");
  revalidatePath("/checkout");
  return { ok: true };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `actions.ts`.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/settings/actions.ts"
git commit -m "feat(payments): updatePaymentSettings admin server action"
```

---

### Task 5: Admin `PaymentSettingsForm` + render on settings page

**Files:**
- Create: `components/admin/payment-settings-form.tsx`
- Modify: `app/(admin)/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `paymentCategories`, `paymentMethods` from `data/payment-methods`; `PaymentSettings` from `lib/settings/payments`; `updatePaymentSettings` from the settings actions; `Switch`, `Input`, `Label` from `components/ui/*`.
- Produces: `function PaymentSettingsForm({ initial }: { initial: PaymentSettings })`.

- [ ] **Step 1: Create `components/admin/payment-settings-form.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { paymentCategories, paymentMethods } from "@/data/payment-methods";
import type { PaymentSettings } from "@/lib/settings/payments";
import { updatePaymentSettings } from "@/app/(admin)/admin/settings/actions";

export function PaymentSettingsForm({ initial }: { initial: PaymentSettings }) {
  const [s, setS] = useState<PaymentSettings>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updatePaymentSettings(s);
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base font-bold tracking-tight">Payments</h2>
        <p className="text-xs text-muted-foreground">
          Turn whole categories or individual methods on or off. Disabled methods don&rsquo;t
          appear at checkout.
        </p>
      </div>

      {paymentCategories.map((cat) => {
        const methods = paymentMethods.filter((m) => m.category === cat.id);
        const catOn = s.categories[cat.id];
        return (
          <div key={cat.id} className="flex flex-col gap-3 rounded-xl bg-neutral-50 p-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-bold">{cat.label}</span>
              <Switch
                checked={catOn}
                onCheckedChange={(v) =>
                  setS({ ...s, categories: { ...s.categories, [cat.id]: v } })
                }
              />
            </div>

            <div className="flex flex-col gap-2.5 pl-1">
              {methods.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col">
                    <span
                      className={catOn ? "text-sm font-medium" : "text-sm font-medium text-muted-foreground"}
                    >
                      {m.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{m.description}</span>
                  </div>
                  <Switch
                    checked={s.methods[m.id]}
                    disabled={!catOn}
                    onCheckedChange={(v) =>
                      setS({ ...s, methods: { ...s.methods, [m.id]: v } })
                    }
                  />
                </div>
              ))}
            </div>

            {cat.id === "bank" && (
              <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bank-name">Bank name</Label>
                  <Input
                    id="bank-name"
                    value={s.bank.name}
                    onChange={(e) => setS({ ...s, bank: { ...s.bank, name: e.target.value } })}
                    placeholder="e.g. Maybank"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bank-account-number">Account number</Label>
                  <Input
                    id="bank-account-number"
                    value={s.bank.accountNumber}
                    onChange={(e) =>
                      setS({ ...s, bank: { ...s.bank, accountNumber: e.target.value } })
                    }
                    placeholder="e.g. 1234567890"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bank-account-holder">Account holder</Label>
                  <Input
                    id="bank-account-holder"
                    value={s.bank.accountHolder}
                    onChange={(e) =>
                      setS({ ...s, bank: { ...s.bank, accountHolder: e.target.value } })
                    }
                    placeholder="e.g. Naise Coffee Sdn Bhd"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {msg && (
        <p className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{msg.text}</p>
      )}
      <button
        onClick={save}
        disabled={pending}
        className="self-start rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save payments"}
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Render it on the settings page**

Replace the contents of `app/(admin)/admin/settings/page.tsx` with:

```tsx
import { getStoreSettings } from "@/lib/settings/store";
import { getPaymentSettings } from "@/lib/settings/payments";
import { SettingsForm } from "@/components/admin/settings-form";
import { PaymentSettingsForm } from "@/components/admin/payment-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, payments] = await Promise.all([getStoreSettings(), getPaymentSettings()]);
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Settings</h1>
      <SettingsForm initial={settings} />
      <PaymentSettingsForm initial={payments} />
    </div>
  );
}
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors from these files (Task 6 `methodIcons` error may still show until Task 6).

- [ ] **Step 4: Commit**

```bash
git add "components/admin/payment-settings-form.tsx" "app/(admin)/admin/settings/page.tsx"
git commit -m "feat(payments): admin payment settings form on /admin/settings"
```

---

### Task 6: Checkout integration (enabled list, Bank Transfer card, empty state)

**Files:**
- Modify: `app/(customer)/checkout/page.tsx`
- Modify: `components/checkout-screen.tsx`

**Interfaces:**
- Consumes: `getPaymentSettings`, `getEnabledPaymentMethods` from `lib/settings/payments`; `BankDetails` from `lib/settings/payments`; `PaymentMethod` from `types/payment`.
- Produces: `CheckoutScreen` now accepts `methods: PaymentMethod[]` and `bank: BankDetails` props (in addition to existing `closedMessage`).

- [ ] **Step 1: Update the checkout page to fetch + pass payment data**

Replace the contents of `app/(customer)/checkout/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/checkout-screen";
import { getStoreSettings } from "@/lib/settings/store";
import { getPaymentSettings, getEnabledPaymentMethods } from "@/lib/settings/payments";

export const metadata: Metadata = {
  title: "Checkout",
};

export default async function CheckoutPage() {
  const [settings, payments] = await Promise.all([getStoreSettings(), getPaymentSettings()]);
  const methods = getEnabledPaymentMethods(payments);
  return (
    <CheckoutScreen
      closedMessage={settings.isOpen ? null : settings.closedMessage}
      methods={methods}
      bank={payments.bank}
    />
  );
}
```

- [ ] **Step 2: Update `components/checkout-screen.tsx` — imports, icon map, props, selection state**

In `components/checkout-screen.tsx`:

(a) In the lucide-react import block, add `Copy`, `Landmark`, and `Check` is already imported. The new icons needed are `Landmark` (bank) and `Copy` (copy buttons). Add them to the existing `lucide-react` import list.

(b) Replace the `methodIcons` map to add `bank-transfer`:

```tsx
const methodIcons: Record<PaymentMethodId, LucideIcon> = {
  cash: Banknote,
  "duitnow-qr": QrCode,
  "apple-pay": Apple,
  "google-pay": CreditCard,
  "tng-ewallet": Wallet,
  boost: Zap,
  grabpay: Smartphone,
  "bank-transfer": Landmark,
};
```

(c) Change the imports near the top so the catalog no longer drives the list. Remove:

```tsx
import { paymentMethods, defaultPaymentMethodId } from "@/data/payment-methods";
import type { PaymentMethodId } from "@/types/payment";
```

and replace with:

```tsx
import type { PaymentMethod, PaymentMethodId } from "@/types/payment";
import type { BankDetails } from "@/lib/settings/payments";
```

(d) Change the component signature and derive the selection from props:

```tsx
export function CheckoutScreen({
  closedMessage,
  methods,
  bank,
}: {
  closedMessage?: string | null;
  methods: PaymentMethod[];
  bank: BankDetails;
}) {
```

(e) Replace the `selected` state initializer. The old line:

```tsx
  const [selected, setSelected] =
    useState<PaymentMethodId>(defaultPaymentMethodId);
```

becomes (default to the first enabled method, or `null` if none):

```tsx
  const [selected, setSelected] = useState<PaymentMethodId | null>(
    methods[0]?.id ?? null,
  );
```

- [ ] **Step 3: Update all `paymentMethods` references and the guest/auth effect**

In `components/checkout-screen.tsx`, every reference to the imported `paymentMethods` must now use the `methods` prop:

(a) The guest-method reconciliation effect — replace the effect body that referenced `paymentMethods` with one that operates over `methods` and tolerates a `null` selection:

```tsx
  // A guest can't keep a members-only method (Cash) selected. Once auth state
  // is known, move them to the first non-gated enabled method.
  useEffect(() => {
    if (!authHydrated || isAuthenticated) return;
    const current = methods.find((m) => m.id === selected);
    if (current?.requiresAuth) {
      const fallback = methods.find((m) => !m.requiresAuth);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile selection once auth state is known
      setSelected(fallback ? fallback.id : null);
    }
  }, [authHydrated, isAuthenticated, selected, methods]);
```

(b) The `featured` / `others` split:

```tsx
  const featured = methods.filter((m) => m.featured);
  const others = methods.filter((m) => !m.featured);
```

(c) In `selectMethod`, replace `paymentMethods.find(...)` with `methods.find(...)`:

```tsx
  function selectMethod(id: PaymentMethodId) {
    const method = methods.find((m) => m.id === id);
    if (!isAuthenticated && method?.requiresAuth) {
      setShowGuestModal(true);
      return;
    }
    setSelected(id);
  }
```

(d) In `placeOrder`, replace `paymentMethods.find(...)` with `methods.find(...)` (the line `const method = paymentMethods.find((m) => m.id === selected);`).

- [ ] **Step 4: Add the Bank Transfer details card + render the empty state**

In `components/checkout-screen.tsx`, inside the `Payment Method` section, after the existing DuitNow QR blocks (the `{selected === "duitnow-qr" && (...)}` blocks) and before the closing `</section>`, add the Bank Transfer card and the empty-state notice. Also wrap the existing featured/others selector lists so they only render when `methods.length > 0`.

Add this helper component at the bottom of the file (outside `CheckoutScreen`):

```tsx
function BankDetailRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context / denied) — leave the value
      // visible for manual copy; nothing to surface.
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="truncate text-sm font-semibold">{value}</span>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-foreground transition-colors hover:bg-neutral-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {copied ? (
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        ) : (
          <Copy className="size-3.5" strokeWidth={2} aria-hidden />
        )}
      </button>
    </div>
  );
}
```

Then add the Bank Transfer block right after the DuitNow QR receipt block:

```tsx
        {selected === "bank-transfer" && (
          <div className="mt-4 flex flex-col rounded-2xl border border-border bg-white px-4 py-2 divide-y divide-border">
            {bank.name && <BankDetailRow label="Bank" value={bank.name} />}
            {bank.accountNumber && (
              <BankDetailRow label="Account number" value={bank.accountNumber} />
            )}
            {bank.accountHolder && (
              <BankDetailRow label="Account holder" value={bank.accountHolder} />
            )}
            {!bank.name && !bank.accountNumber && !bank.accountHolder && (
              <p className="py-3 text-xs text-muted-foreground">
                Bank details aren&rsquo;t set up yet. Please choose another method or contact
                the store.
              </p>
            )}
          </div>
        )}
```

For the empty state (no methods enabled at all), wrap the selector. Replace the opening of the grid block so that when `methods.length === 0` a notice shows instead. Immediately after the `<h2>Payment Method</h2>` line, add:

```tsx
        {methods.length === 0 && (
          <p className="rounded-2xl bg-neutral-50 px-4 py-3 text-xs text-muted-foreground">
            Payments are temporarily unavailable. Please try again later or contact the store.
          </p>
        )}
```

- [ ] **Step 5: Block Place Order when nothing is selectable**

In `components/checkout-screen.tsx`, in `onPlaceOrder`, guard against a `null` selection at the very top of the function body:

```tsx
  function onPlaceOrder() {
    if (submitting) return;
    if (!selected) {
      setError("No payment method is available right now.");
      return;
    }
    if (!isAuthenticated) {
      setShowGuestModal(true);
      return;
    }
    if (!resolveContactPhone()) {
      setShowPhonePrompt(true);
      return;
    }
    void placeOrder();
  }
```

Also update the Place Order button's `disabled` to include no-selection:

```tsx
        disabled={submitting || !selected}
```

(Find the `<button type="button" onClick={onPlaceOrder} disabled={submitting}` and change `disabled={submitting}` to `disabled={submitting || !selected}`.)

- [ ] **Step 6: Type-check, lint, and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all PASS, no errors. (This is the gate that the Task 2/3/5 `methodIcons` interim error is now resolved.)

- [ ] **Step 7: Manual verification**

Start `npm run dev`. As an admin:
1. Go to `/admin/settings`. Confirm the **Payments** card shows 5 category groups, each with a master switch and nested method switches; the Bank group shows 3 text inputs.
2. Toggle the **E-Wallet** category off, Save. Open `/checkout` (with items in cart) — Touch 'n Go, Boost, GrabPay are gone.
3. Re-enable E-Wallet but turn **Boost** off, Save. At checkout, GrabPay and Touch 'n Go remain; Boost is gone.
4. Fill the bank details, ensure **Bank Transfer** is on, Save. At checkout, select Bank Transfer — the details card shows with working copy buttons; no receipt upload prompt appears.
5. Place a Bank Transfer order — confirm it succeeds and the order's payment method reads "Bank Transfer".
6. Turn off **every** category, Save. At checkout, the "Payments are temporarily unavailable" notice shows and Place Order is disabled.
7. As a non-admin (or signed out), confirm `/admin/settings` is not accessible (existing route guard) and `/checkout` still reads payment config (fail-open).

- [ ] **Step 8: Commit**

```bash
git add "app/(customer)/checkout/page.tsx" "components/checkout-screen.tsx"
git commit -m "feat(payments): checkout honors enabled methods + Bank Transfer details card"
```

---

## Self-Review Notes

- **Spec coverage:** category+method toggles (Task 5), Bank Transfer method (Task 2) + checkout card without receipt (Task 6), admin-editable bank details (Tasks 1/4/5), DB table + RLS (Task 1), fail-open reads (Task 3), checkout filtering + default-to-first-enabled + empty state (Task 6). All spec sections map to a task.
- **Type consistency:** `PaymentSettings` shape (`categories`/`methods`/`bank`) is identical across Tasks 3, 4, 5, 6. `BankDetails` (`name`/`accountNumber`/`accountHolder`) consistent across helper, action, form, and checkout card. Column names match between the migration (Task 1) and the `Row`/update maps (Tasks 3/4).
- **Known interim error:** Tasks 2–5 leave one expected `tsc` error (`methodIcons` missing `bank-transfer`) that Task 6 resolves; the full green gate (`tsc + lint + build`) runs at Task 6 Step 6. This is called out in each affected step.
- **No new libraries; no test runner** — verification is type-check, lint, build, and the manual script in Task 6.
