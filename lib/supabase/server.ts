import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

// Server-side client for Server Components, Server Actions, and Route Handlers.
// Uses the request cookie store. The setAll try/catch is required: Server
// Components cannot write cookies, so writes there are no-ops (the proxy
// refreshes the session instead).
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              // Force Secure in prod so the session token (written here on
              // sign-in / OAuth callback) never rides plaintext; dev over
              // http://localhost is left untouched. Matches proxy.ts.
              cookieStore.set(name, value, {
                ...options,
                secure:
                  process.env.NODE_ENV === "production" ? true : options.secure,
              }),
            );
          } catch {
            // Called from a Server Component — ignore; proxy handles refresh.
          }
        },
      },
    },
  );
}
