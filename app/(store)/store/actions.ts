// app/(store)/store/actions.ts
"use server";

import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { setStoreModeCookie, clearStoreModeCookie } from "@/lib/auth/store-mode";
import { verifyStorePasscode } from "@/lib/auth/store-passcode";

type Result = { ok: true } | { ok: false; error: string };

export async function enterStoreMode(passcode: string): Promise<Result> {
  if (!(await getStoreAccountEnabled())) {
    return { ok: false, error: "Store ordering is off." };
  }
  if (!(await verifyStorePasscode(passcode))) {
    return { ok: false, error: "Incorrect passcode." };
  }
  await setStoreModeCookie();
  return { ok: true };
}

export async function exitStoreMode(passcode: string): Promise<Result> {
  // Passcode-gated so a customer on a dedicated tablet can't escape the kiosk.
  if (!(await verifyStorePasscode(passcode))) {
    return { ok: false, error: "Incorrect passcode." };
  }
  await clearStoreModeCookie();
  return { ok: true };
}
