import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth/session";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";

export const dynamic = "force-dynamic";

export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  const role = await getSessionRole();
  if (role !== "store") redirect("/store/login");
  if (!(await getStoreAccountEnabled())) redirect("/store/login");
  return <>{children}</>;
}
