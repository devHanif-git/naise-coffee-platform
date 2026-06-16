// Shared owner-id constants. No `"use client"` directive — safe to import
// from both client and server modules. Keeps the cookie name in one place.

export const OWNER_ID_COOKIE = "naise_owner_id";
export const OWNER_ID_STORAGE_KEY = "naise-owner-id";
// 1 year — long enough that a returning guest's history doesn't disappear.
export const OWNER_ID_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
