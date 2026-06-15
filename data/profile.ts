import type { CustomerProfile } from "@/types/profile";

// MOCK profile for the signed-in customer. Used as the server-rendered / first-
// client-render value before the localStorage-backed store hydrates, matching
// how data/rewards.ts seeds the Beans store. Replace with a Supabase fetch of
// the `profiles` row once auth lands.
export const mockProfile: CustomerProfile = {
  displayName: "Naise Member",
  memberSince: "2025-09-01T00:00:00.000Z",
};
