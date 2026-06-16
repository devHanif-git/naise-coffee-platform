// Stable per-browser identifier used to attribute orders to *someone* —
// guest or member — before Supabase Auth lands. The same id is reused when a
// guest registers, so orders placed before sign-up automatically belong to
// the new account (no rewriting rows). On Supabase later this maps to
// `orders.user_id` once the row carries `auth.uid()`; the migration becomes a
// single UPDATE keyed on this id.
//
// The id lives in two places that are kept in sync:
//   - localStorage (`naise-owner-id`)  → read on the client
//   - cookie       (`naise_owner_id`)  → read by Server Components
// Mirroring to a cookie lets the profile page render server-side (SSR + SEO)
// while still scoping orders to this browser. Cookie is non-HttpOnly on
// purpose: it's not a credential, just an opaque correlation id; the server
// doesn't trust it for authorization (mock today, RLS later).

"use client";

import {
  OWNER_ID_COOKIE,
  OWNER_ID_COOKIE_MAX_AGE_SECONDS,
  OWNER_ID_STORAGE_KEY,
} from "@/lib/auth/owner-id-shared";

function writeCookie(id: string): void {
  // SameSite=Lax so the cookie is sent on top-level navigations (the SSR fetch
  // for /profile etc.) but not on cross-site embeds. No Secure flag in dev so
  // it works on http://localhost; production is served over https either way.
  document.cookie =
    `${OWNER_ID_COOKIE}=${encodeURIComponent(id)}; path=/; ` +
    `max-age=${OWNER_ID_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

// Returns the existing owner id, or mints + persists a new one. Safe to call
// on every client render — no-op once the id is set.
export function getOrCreateOwnerId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(OWNER_ID_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode, etc.); fall through to mint.
  }
  if (!id) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(OWNER_ID_STORAGE_KEY, id);
    } catch {
      // Non-fatal; cookie still gives the server something to scope by.
    }
  }
  // Always refresh the cookie — bumps the expiry and recovers if it was
  // cleared independently of localStorage.
  writeCookie(id);
  return id;
}

// Replace the stored owner id. Used when a member signs in on a device that
// already has a different owner id (e.g. signing into their account on a
// shared browser): adopt the member's canonical id so future orders attach to
// it, not the guest record.
export function setOwnerId(id: string): void {
  try {
    localStorage.setItem(OWNER_ID_STORAGE_KEY, id);
  } catch {
    // Non-fatal.
  }
  writeCookie(id);
}
