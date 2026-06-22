import { redirect } from "next/navigation";

// /store/cart is retired — the kiosk cart now lives in the floating sheet on the
// menu (/store). Redirect any direct hits to the menu.
export default function StoreCartPage() {
  redirect("/store");
}
