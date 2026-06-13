import type { Metadata } from "next";
import { categories, products } from "@/data/menu";
import { MenuBrowser } from "@/components/menu-browser";

export const metadata: Metadata = {
  title: "Menu",
  description:
    "Browse the Naise Coffee menu — coffee, non-coffee, and matcha drinks. Customize and order over WhatsApp.",
  openGraph: {
    title: "Menu · Naise Coffee",
    description:
      "Browse the Naise Coffee menu — coffee, non-coffee, and matcha drinks.",
    type: "website",
  },
};

export default function MenuPage() {
  return <MenuBrowser categories={categories} products={products} />;
}
