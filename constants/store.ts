// Fixed login identity for the shared in-store kiosk account. The passcode is
// this user's password (set/rotated from admin). Not a secret on its own.
export const STORE_ACCOUNT_EMAIL = "store@naise.coffee";

// owner_id stamped on every kiosk order. orders.owner_id is NOT NULL and is
// guarded by a UUID-format CHECK constraint, so this must be a valid UUID. Kiosk
// orders have no per-browser identity, so they share this fixed sentinel — a
// real customer's random owner_id can never collide with it.
export const STORE_OWNER_ID = "00000000-0000-4000-8000-000000005702";

// Separate localStorage keys so the kiosk cart never collides with the
// customer-app cart on the same browser.
export const STORE_CART_KEY = "naise-store-cart";
export const STORE_CART_NOTES_KEY = "naise-store-cart-notes";

// Self-serve reset timings.
export const STORE_IDLE_TIMEOUT_MS = 180_000; // clear an abandoned cart after 3 min idle
export const STORE_CONFIRMATION_RESET_MS = 15_000; // confirmation → back to menu (idle)
// While the customer is mid-way through typing their member phone/email for a
// stamp, give them a long window before the kiosk resets — every keystroke
// restarts this timer, so it only fires after ~3 min of no typing.
export const STORE_CONFIRMATION_RESET_HOLD_MS = 180_000;
