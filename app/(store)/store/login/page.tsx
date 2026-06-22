import { redirect } from "next/navigation";
import { inStoreMode } from "@/lib/auth/store-mode";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { StoreLoginScreen } from "@/components/store/store-login-screen";

export const dynamic = "force-dynamic";

export default async function StoreLoginPage() {
  const enabled = await getStoreAccountEnabled();
  // Already unlocked and ordering on -> straight into the kiosk.
  if (enabled && (await inStoreMode())) redirect("/store");
  // Otherwise show the unlock prompt (or the "ordering off" message). We do NOT
  // redirect signed-in users away anymore — anyone with the passcode can enter.
  return <StoreLoginScreen disabled={!enabled} />;
}
