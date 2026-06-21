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

// A partial edit to the profile. Avatar, display name, and the (unverified)
// WhatsApp number — security settings live on the Settings screen. Partial so
// callers can update one field (e.g. the checkout nudge writes only `phone`)
// without clobbering the others; updateProfile persists exactly the keys given.
export type ProfileEdit = Partial<
  Pick<CustomerProfile, "displayName" | "avatarUrl" | "phone">
>;
