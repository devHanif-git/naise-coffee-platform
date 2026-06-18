import type { Metadata } from "next";
import { RewardsScreen } from "@/components/rewards-screen";

export const metadata: Metadata = {
  title: "Rewards",
  description:
    "Earn Beans on every Naise Coffee order and redeem them for free drinks.",
};

export default function RewardsPage() {
  return <RewardsScreen />;
}
