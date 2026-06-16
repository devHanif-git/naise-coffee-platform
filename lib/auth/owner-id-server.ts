// Server-side reader for the owner-id cookie. Used by Server Components
// (e.g. the profile page) to scope `listOrdersFor(...)` to this browser
// without shipping the order list to the client. Returns null when the
// cookie is missing — the page should render the empty state in that case.

import { cookies } from "next/headers";
import { OWNER_ID_COOKIE } from "@/lib/auth/owner-id-shared";

export async function getOwnerIdFromCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(OWNER_ID_COOKIE)?.value;
  return value && value.length > 0 ? value : null;
}
