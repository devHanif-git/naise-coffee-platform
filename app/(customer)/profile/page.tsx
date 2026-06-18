import type { Metadata } from "next";
import { listOrdersFor } from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";
import { ProfileScreen } from "@/components/profile-screen";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your Naise Coffee profile, rewards, and recent orders.",
};

// Cap the profile preview at the 3 most recent orders; the full history lives
// at /profile/orders. Both signed-in members and guests see only their own
// orders — scoped by the per-browser owner id cookie until Supabase Auth +
// RLS take over.
const RECENT_ORDERS_LIMIT = 3;

export default async function ProfilePage() {
  const ownerId = await getOwnerIdFromCookie();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recentOrders = (await listOrdersFor(ownerId, user?.id ?? null)).slice(0, RECENT_ORDERS_LIMIT);

  return <ProfileScreen recentOrders={recentOrders} />;
}
