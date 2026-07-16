import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth/session";
import { getOpenShift } from "@/lib/shifts/store";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  UnsavedChangesProvider,
  UnsavedChangesDialog,
} from "@/components/admin/unsaved-changes";

export const metadata: Metadata = {
  title: "Naise Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAdmin())) redirect("/");
  const openShift = await getOpenShift();
  return (
    <UnsavedChangesProvider>
      <AdminShell openSince={openShift?.openedAt ?? null}>{children}</AdminShell>
      <UnsavedChangesDialog />
    </UnsavedChangesProvider>
  );
}
