import { requireUser } from "@/lib/auth/session";

// Members-only subtree. Logged-out visitors are redirected to /login with a
// return path; this also covers every nested route below.
export default async function GatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return <>{children}</>;
}
