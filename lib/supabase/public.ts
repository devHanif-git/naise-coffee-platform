import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Cookie-free Supabase client for PUBLIC catalog reads only (products,
// categories, add-ons, promotions). Because it never touches request cookies, it
// runs as the anonymous role — which RLS already scopes to non-archived public
// rows — and, crucially, can be called inside `unstable_cache` (cookies()/
// headers() are forbidden there). Never use this for per-user or privileged data.
export function createPublicClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
