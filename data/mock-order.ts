import type { Order } from "@/types/order";

// MOCK order used by /manage/test to exercise the manage screen without a real
// order. Prices are in sen (1 MYR = 100 sen). This is a builder, not a shared
// constant, so /manage/test gets a fresh object on every request — there is no
// state to mutate or reset yet. Real orders come from the store/Supabase later.
export function mockOrder(): Order {
  const items = [
    {
      name: "Spanish Latte",
      quantity: 2,
      sizeName: "Large",
      addonNames: ["Extra Shot", "Oat Milk"],
      unitPrice: 1450,
    },
    {
      name: "Matcha Latte",
      quantity: 1,
      sizeName: "Regular",
      addonNames: [],
      unitPrice: 1300,
    },
    {
      name: "Iced Americano",
      quantity: 1,
      sizeName: "Large",
      addonNames: ["Less Ice"],
      unitPrice: 1000,
    },
  ].map((item) => ({
    ...item,
    lineTotal: item.unitPrice * item.quantity,
    status: "pending" as const,
  }));

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

  return {
    token: "test",
    orderNumber: "NAISE-000000",
    ownerId: "mock-test",
    status: "pending",
    paymentMethod: "DuitNow QR",
    proofOfPaymentUrl: "/brand/coffee_with_logo.png",
    items,
    subtotal,
    total: subtotal,
    notes: "Please make the matcha less sweet. Thanks!",
    createdAt: new Date().toISOString(),
  };
}
