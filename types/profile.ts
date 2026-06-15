// The signed-in customer's profile. Mocked today (no auth yet); maps onto the
// `profiles` table once Supabase Auth lands. `avatarUrl` holds a data URL while
// avatars are stored client-side; it becomes a Supabase Storage URL later.
export type CustomerProfile = {
  displayName: string;
  avatarUrl?: string;
  // ISO timestamp of when the customer joined, shown as "Member since ...".
  memberSince: string;
  phone?: string;
};

// The fields the Edit Profile screen can change. Avatar and display name only —
// security settings live on the Settings screen.
export type ProfileEdit = Pick<CustomerProfile, "displayName" | "avatarUrl">;
