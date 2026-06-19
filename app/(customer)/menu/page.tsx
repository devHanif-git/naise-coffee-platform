import type { Metadata } from "next";
import { listCategories, listProducts } from "@/lib/menu/store";
import { MenuBrowser } from "@/components/menu-browser";

export const dynamic = "force-dynamic";

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

export default async function MenuPage() {
  const [categories, products] = await Promise.all([listCategories(), listProducts()]);
  return <MenuBrowser categories={categories} products={products} />;
}
