// Payment options offered at checkout. Cash and DuitNow QR are the everyday
// choices, so they are flagged `featured` to surface them above the wallets.
export type PaymentMethodId =
  | "cash"
  | "duitnow-qr"
  | "apple-pay"
  | "google-pay"
  | "tng-ewallet"
  | "boost"
  | "grabpay";

export type PaymentMethod = {
  id: PaymentMethodId;
  name: string;
  // Short helper line shown under the name.
  description: string;
  // Featured methods render as large cards at the top of the selector.
  featured?: boolean;
};
