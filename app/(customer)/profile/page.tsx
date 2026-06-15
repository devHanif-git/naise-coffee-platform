import type { Metadata } from "next";
import { listOrders } from "@/lib/orders/store";
import { ProfileScreen } from "@/components/profile-screen";

export const runtime = "edge";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your Naise Coffee profile, rewards, and recent orders.",
};

// Cap the profile preview at the 3 most recent orders; the full history lives
// at /profile/orders. Reuses the shared mock order store until Supabase lands.
const RECENT_ORDERS_LIMIT = 3;

export default function ProfilePage() {
  const recentOrders = listOrders().slice(0, RECENT_ORDERS_LIMIT);

  return <ProfileScreen recentOrders={recentOrders} />;
}
