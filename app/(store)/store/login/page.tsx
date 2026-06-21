import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth/session";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { StoreLoginForm } from "@/components/store/store-login-form";

export const dynamic = "force-dynamic";

export default async function StoreLoginPage() {
  const role = await getSessionRole();
  if (role === "store" && (await getStoreAccountEnabled())) redirect("/store");
  // A non-store signed-in user (admin/customer) shouldn't sit on the kiosk login.
  if (role && role !== "store") redirect("/");

  const disabled = role === "store" && !(await getStoreAccountEnabled());
  return <StoreLoginForm disabled={disabled} />;
}
