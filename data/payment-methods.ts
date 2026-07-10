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
    requiresReceipt: true,
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
    // Cash it does NOT require auth — guests can use it. It does require proof
    // of payment, so the customer attaches a transfer receipt at checkout.
    id: "bank-transfer",
    category: "bank",
    name: "Bank Transfer",
    description: "Transfer to our bank account",
    requiresReceipt: true,
  },
];

// The method selected by default when none of the enabled methods dictates
// otherwise. Checkout falls back to the first enabled method at runtime.
export const defaultPaymentMethodId: PaymentMethod["id"] = "cash";

// Sentinel payment_method for a store order placed before payment is decided
// ("Pay later"). NOT a member of `paymentMethods` — it must never be a
// customer-selectable method — but it is a valid stored value that staff later
// overwrite with a real method. See paymentMethodLabel below for its label.
export const UNPAID_PAYMENT_METHOD = "unpaid";

// Orders historically stored their payment method inconsistently: the online
// checkout saved the display name ("DuitNow QR") while the in-store kiosk saved
// the method id ("duitnow-qr"). That split the same method into separate rows in
// reports. Both surfaces now store the id; these helpers canonicalize any value
// (id, display name, or casing variant) so reads group and label consistently.
const methodById = new Map<string, PaymentMethod>(
  paymentMethods.map((m) => [m.id, m]),
);
const idByName = new Map<string, string>(
  paymentMethods.map((m) => [m.name.toLowerCase(), m.id]),
);

// Canonical method id for any stored payment_method value. Unknown values pass
// through unchanged so nothing is silently dropped.
export function normalizePaymentMethod(value: string): string {
  if (methodById.has(value)) return value;
  return idByName.get(value.trim().toLowerCase()) ?? value;
}

// True for any value that is a real, storable payment_method: a catalog method
// id or the `unpaid` sentinel. Used to sanity-check the manage board's payment
// filter before it reaches a query — an unknown value falls back to "all".
export function isKnownPaymentValue(value: string): boolean {
  return value === UNPAID_PAYMENT_METHOD || methodById.has(value);
}

// Human-readable label for a stored payment_method value. Falls back to a
// prettified form for any value not in the catalogue (legacy/removed methods).
export function paymentMethodLabel(value: string): string {
  if (value === UNPAID_PAYMENT_METHOD) return "Unpaid";
  const method = methodById.get(normalizePaymentMethod(value));
  if (method) return method.name;
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
