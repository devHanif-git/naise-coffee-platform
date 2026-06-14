// Roles mirror the set defined in AGENTS.md. `customer` is the default; the
// management surfaces (order links, CMS) are gated to admin/manager/staff.
export type Role = "admin" | "manager" | "staff" | "customer";

// Roles permitted to open an order management link. "Seller"-type access maps
// onto staff/manager here.
export const MANAGE_ROLES: readonly Role[] = ["admin", "manager", "staff"];
