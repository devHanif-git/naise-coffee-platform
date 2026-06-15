import type { PaymentMethod } from "@/types/payment";

// Order matters: featured methods (Cash, DuitNow QR) come first so the selector
// can render them as the prominent cards. Icons are mapped in the UI layer to
// keep this file pure content.
export const paymentMethods: PaymentMethod[] = [
  {
    id: "cash",
    name: "Cash",
    description: "Pay at the counter on pickup",
    featured: true,
    requiresAuth: true,
  },
  {
    id: "duitnow-qr",
    name: "DuitNow QR",
    description: "Scan with any bank app",
    featured: true,
  },
  {
    id: "apple-pay",
    name: "Apple Pay",
    description: "Pay with Apple Pay",
  },
  {
    id: "google-pay",
    name: "Google Pay",
    description: "Pay with Google Pay",
  },
  {
    id: "tng-ewallet",
    name: "Touch 'n Go eWallet",
    description: "Pay with your TNG balance",
  },
  {
    id: "boost",
    name: "Boost",
    description: "Pay with Boost",
  },
  {
    id: "grabpay",
    name: "GrabPay",
    description: "Pay with GrabPay",
  },
];

// The method selected by default. Cash is the most common choice.
export const defaultPaymentMethodId: PaymentMethod["id"] = "cash";
