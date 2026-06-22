import { redirect } from "next/navigation";

// /cart is retired — the cart now lives in the floating sheet on /menu.
// Redirect any direct hits (old links, bookmarks) to /menu.
export default function CartPage() {
  redirect("/menu");
}
