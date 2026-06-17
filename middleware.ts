import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// NOTE: Next 16 renamed `middleware` → `proxy` (Node runtime). We stay on the
// Edge `middleware.ts` convention for now; migrating to `proxy.ts` is deferred.
// The function MUST be named `middleware`.
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything EXCEPT:
    //  - Next static/image assets and the favicon
    //  - image files (extensions below)
    //  - PWA/SEO static files (manifest, robots, sitemap, sw)
    //  - the OAuth callback, which exchanges the code + writes cookies itself,
    //    so it doesn't need the proxy session refresh on top (saves CPU there).
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|manifest.webmanifest|robots.txt|sitemap.xml|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
