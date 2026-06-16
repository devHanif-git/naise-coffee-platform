import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// NOTE: Next 16 renamed `middleware` → `proxy`, but the new `proxy.ts` convention
// runs on the Node.js runtime, which the OpenNext Cloudflare adapter does NOT yet
// support (build fails: "Node.js middleware is not currently supported").
// Tracking: https://github.com/opennextjs/opennextjs-cloudflare/issues/617
// Until that lands, we stay on the deprecated-but-working Edge `middleware.ts`.
// The function MUST be named `middleware`. updateSession only uses @supabase/ssr,
// which is Edge-compatible, so nothing breaks.
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
