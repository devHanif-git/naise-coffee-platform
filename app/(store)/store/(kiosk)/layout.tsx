import { redirect } from "next/navigation";
import { inStoreMode } from "@/lib/auth/store-mode";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";

export const dynamic = "force-dynamic";

export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  if (!(await inStoreMode())) redirect("/store/login");
  if (!(await getStoreAccountEnabled())) redirect("/store/login");
  return <>{children}</>;
}
