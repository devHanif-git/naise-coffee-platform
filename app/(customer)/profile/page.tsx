import type { Metadata } from "next";
import { listOrdersFor } from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/auth/session";
import { listTiers } from "@/lib/rewards/config-store";
import { getStampSettings } from "@/lib/stamps/config-store";
import { getStampCard } from "@/lib/stamps/store";
import { listMyVouchers } from "@/lib/stamps/voucher-store";
import { ProfileScreen } from "@/components/profile-screen";
import { ProfileOrdersLive } from "@/components/profile-orders-live";

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
  const [recentOrders, tiers, role, stampSettings, stampCard] = await Promise.all([
    listOrdersFor(ownerId, user?.id ?? null).then((o) => o.slice(0, RECENT_ORDERS_LIMIT)),
    listTiers(),
    getSessionRole(),
    getStampSettings(),
    user ? getStampCard() : Promise.resolve(null),
  ]);

  const vouchers = user && stampSettings.isEnabled ? await listMyVouchers() : [];

  return (
    <>
      <ProfileScreen
        recentOrders={recentOrders}
        tiers={tiers}
        role={role}
        userId={user?.id ?? null}
        stampSettings={stampSettings}
        stampCard={stampCard}
        vouchers={vouchers}
      />
      <ProfileOrdersLive tokens={recentOrders.map((order) => order.token)} />
    </>
  );
}
