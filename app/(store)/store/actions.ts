// app/(store)/store/actions.ts
"use server";

import { createPublicClient } from "@/lib/supabase/public";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { setStoreModeCookie, clearStoreModeCookie } from "@/lib/auth/store-mode";
import { STORE_ACCOUNT_EMAIL } from "@/constants/store";

type Result = { ok: true } | { ok: false; error: string };

// Verify the passcode WITHOUT signing anyone in: createPublicClient uses
// persistSession:false, so signInWithPassword writes no cookies and the caller's
// session is left intact. We only care whether the credentials are valid.
async function passcodeOk(passcode: string): Promise<boolean> {
  if (passcode.length < 6) return false;
  const supabase = createPublicClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: STORE_ACCOUNT_EMAIL,
    password: passcode,
  });
  return !error;
}

export async function enterStoreMode(passcode: string): Promise<Result> {
  if (!(await getStoreAccountEnabled())) {
    return { ok: false, error: "Store ordering is off." };
  }
  if (!(await passcodeOk(passcode))) {
    return { ok: false, error: "Incorrect passcode." };
  }
  await setStoreModeCookie();
  return { ok: true };
}

export async function exitStoreMode(passcode: string): Promise<Result> {
  // Passcode-gated so a customer on a dedicated tablet can't escape the kiosk.
  if (!(await passcodeOk(passcode))) {
    return { ok: false, error: "Incorrect passcode." };
  }
  await clearStoreModeCookie();
  return { ok: true };
}
