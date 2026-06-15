import type { Metadata } from "next";
import { OrderDetail } from "@/components/order-detail";
import { mockOrder } from "@/data/mock-order";

// Test harness for the manage screen. Renders the same OrderDetail view with
// hardcoded mock data — no auth gate, no store lookup. Refreshing rebuilds the
// mock from scratch, so there is nothing to save or reset. Real persistence
// (Supabase) lands later.
export const metadata: Metadata = {
  title: "Manage Order (Test)",
  robots: { index: false, follow: false },
};

export default function ManageOrderTestPage() {
  return <OrderDetail order={mockOrder()} persist={false} />;
}
