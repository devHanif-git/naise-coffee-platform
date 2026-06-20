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
