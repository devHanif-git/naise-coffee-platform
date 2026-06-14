import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/checkout-screen";

export const runtime = "edge";

export const metadata: Metadata = {
  title: "Checkout",
};

export default function CheckoutPage() {
  return <CheckoutScreen />;
}
