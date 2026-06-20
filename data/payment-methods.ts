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
