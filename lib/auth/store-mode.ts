// lib/auth/store-mode.ts
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

// Store mode is a signed, httpOnly cookie layered on top of whatever session
// (or guest) the browser already has. It NEVER swaps the Supabase session, so
// exiting returns the user to exactly where they were. The HMAC stops trivial
// client-side forgery; the authoritative kill switch stays `store_account.
// is_enabled`, re-checked server-side on every kiosk request (fail-closed).
export const STORE_MODE_COOKIE = "naise_store";

function secret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Store mode requires SUPABASE_SERVICE_ROLE_KEY.");
  return key;
}

// token = "<issuedAtMs>.<hex hmac of issuedAtMs>". issuedAt is informational
// (no expiry — a dedicated kiosk tablet must survive reboots); revocation is the
// kill switch, not the cookie lifetime.
function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function makeToken(): string {
  const issued = String(Date.now());
  return `${issued}.${sign(issued)}`;
}

function isValid(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

export async function inStoreMode(): Promise<boolean> {
  const store = await cookies();
  return isValid(store.get(STORE_MODE_COOKIE)?.value);
}

export async function setStoreModeCookie(): Promise<void> {
  const store = await cookies();
  store.set(STORE_MODE_COOKIE, makeToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year; revocation is the kill switch
  });
}

export async function clearStoreModeCookie(): Promise<void> {
  const store = await cookies();
  store.delete(STORE_MODE_COOKIE);
}
