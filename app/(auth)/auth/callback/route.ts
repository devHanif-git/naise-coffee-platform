import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { claimDeviceOrders } from "@/lib/orders/claim";

// Supabase redirects here after Google. Exchange the PKCE code for a session
// (cookies are set by the server client), then send the user to `next`.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/home";
  // Only allow same-site relative redirects.
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/home";

  // Behind App Service + Cloudflare, request.url's host is the internal
  // container (e.g. http://<id>:8080), so we can't build the public redirect
  // from it. Use the canonical public origin instead, falling back to the
  // request origin only for local dev where the two are the same.
  const publicOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Re-own any guest orders placed on this browser before signing in, so
      // they move under the new account. Best-effort; never blocks the redirect.
      const ownerId = await getOwnerIdFromCookie();
      await claimDeviceOrders(ownerId);
      return NextResponse.redirect(`${publicOrigin}${next}`);
    }
  }

  return NextResponse.redirect(`${publicOrigin}/login?error=auth`);
}

