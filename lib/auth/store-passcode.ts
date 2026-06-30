// Verify the store-account passcode WITHOUT signing anyone in. The public client
// uses persistSession:false, so signInWithPassword writes no cookies and the
// caller's own session is left intact — we only care whether the credentials are
// valid. This is the "kiosk passcode" managers know: it gates entering/exiting
// store mode and, on the manage screen, correcting an order's payment method.
import { createPublicClient } from "@/lib/supabase/public";
import { STORE_ACCOUNT_EMAIL } from "@/constants/store";

export async function verifyStorePasscode(passcode: string): Promise<boolean> {
  if (passcode.length < 6) return false;
  const supabase = createPublicClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: STORE_ACCOUNT_EMAIL,
    password: passcode,
  });
  return !error;
}
