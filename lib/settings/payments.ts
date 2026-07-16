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
  // Public URL of the uploaded DuitNow QR; null = use the bundled fallback.
  duitnowQrUrl: string | null;
  // When true, the kiosk offers a "Pay later" option (store orders only).
  payLaterEnabled: boolean;
  // CHIP payment-gateway config. enabled routes DuitNow QR through CHIP;
  // feeFlat (sen) + feePercent (basis points, 150 = 1.50%) size the fee added
  // on top of the order total, then clamped into [feeMin, feeMax] (sen; 0 = no
  // bound).
  chip: {
    enabled: boolean;
    feeFlat: number;
    feePercent: number;
    feeMin: number;
    feeMax: number;
  };
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
  duitnowQrUrl: null,
  payLaterEnabled: false,
  // CHIP defaults OFF — unlike the fail-open method toggles, the gateway must be
  // explicitly enabled by an admin. Fee bounds default to 0 (no clamp).
  chip: { enabled: false, feeFlat: 0, feePercent: 0, feeMin: 0, feeMax: 0 },
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
  duitnow_qr_url: string | null;
  pay_later_enabled: boolean;
  chip_enabled: boolean;
  chip_fee_flat: number;
  chip_fee_percent: number;
  chip_fee_min: number;
  chip_fee_max: number;
};

const COLUMNS =
  "cash_enabled, qr_enabled, card_enabled, ewallet_enabled, bank_enabled, " +
  "cash_method_enabled, duitnow_qr_enabled, apple_pay_enabled, google_pay_enabled, " +
  "tng_ewallet_enabled, boost_enabled, grabpay_enabled, bank_transfer_enabled, " +
  "bank_name, bank_account_number, bank_account_holder, duitnow_qr_url, pay_later_enabled, " +
  "chip_enabled, chip_fee_flat, chip_fee_percent, chip_fee_min, chip_fee_max";

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
    duitnowQrUrl: row.duitnow_qr_url,
    payLaterEnabled: row.pay_later_enabled,
    chip: {
      enabled: row.chip_enabled,
      feeFlat: row.chip_fee_flat,
      feePercent: row.chip_fee_percent,
      feeMin: row.chip_fee_min,
      feeMax: row.chip_fee_max,
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
  return map(data as unknown as Row);
}

// The ordered list of methods the customer may actually pick: enabled at BOTH
// the category and the method level. Preserves catalog order.
export function getEnabledPaymentMethods(settings: PaymentSettings): PaymentMethod[] {
  return paymentMethods.filter(
    (m) => settings.categories[m.category] && settings.methods[m.id],
  );
}
