// owner_id stamped on every admin custom order. Like STORE_OWNER_ID, orders.owner_id
// is NOT NULL with a UUID-format CHECK, so this must be a valid UUID. Custom orders
// have no per-customer identity; they share this fixed sentinel, distinct from the
// kiosk's STORE_OWNER_ID so the two channels never collide.
export const CUSTOM_OWNER_ID = "00000000-0000-4000-8000-000000005703";
