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
