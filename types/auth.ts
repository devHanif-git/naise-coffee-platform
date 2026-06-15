// Roles mirror the set defined in AGENTS.md. `customer` is the default; the
// management surfaces (order links, CMS) are gated to admin/manager/staff.
export type Role = "admin" | "manager" | "staff" | "customer";

// Roles permitted to open an order management link. "Seller"-type access maps
// onto staff/manager here.
export const MANAGE_ROLES: readonly Role[] = ["admin", "manager", "staff"];

// How the customer signed in. Mocked today (no real OAuth/OTP yet); maps onto
// Supabase Auth providers once it lands — Google OAuth and phone OTP are the
// two methods the login screen offers (the common pair for Malaysian apps).
export type AuthMethod = "google" | "phone";

// The signed-in customer's auth identity. Distinct from CustomerProfile (the
// editable display fields): this is the credential/session side. A guest has no
// AuthUser — `status` on the store is "guest" until they sign in.
export type AuthUser = {
  // Stable id for the session. A real UUID once Supabase Auth lands; a mock
  // value today so the rest of the app can key off a signed-in identity.
  id: string;
  method: AuthMethod;
  // Set for Google sign-in (the account email); absent for phone sign-in.
  email?: string;
  // Set for phone sign-in (E.164-ish, e.g. "+60123456789"); absent for Google.
  phone?: string;
  name: string;
};
