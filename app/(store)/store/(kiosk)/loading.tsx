import { MenuSkeleton } from "@/components/skeletons/menu-skeleton";

// Kiosk index (/store) is the menu browser, so it shares the customer menu's
// loading shell. Child routes (cart, checkout, product) have their own.
export default function StoreLoading() {
  return <MenuSkeleton />;
}
