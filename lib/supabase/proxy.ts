import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

// Refreshes the Supabase session on every request and syncs cookies onto both
// the request (for Server Components downstream) and the response (for the
// browser). MUST call getClaims() — never getSession() — so the JWT signature
// is validated, not just decoded. Also stamps `x-pathname` on the request so
// server-side gates (requireUser) can build an accurate post-login redirect.
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              // Force Secure in prod (HTTPS behind Cloudflare) so the session
              // token never rides plaintext. Left untouched in dev so
              // http://localhost keeps working. HttpOnly is intentionally NOT
              // set: the @supabase/ssr browser client reads this token from
              // document.cookie for realtime/OAuth, so HttpOnly would break
              // client-side auth.
              secure: process.env.NODE_ENV === "production" ? true : options.secure,
            }),
          );
        },
      },
    },
  );

  // Validates and refreshes the token. Do not remove.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
