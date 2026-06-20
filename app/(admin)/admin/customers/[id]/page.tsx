import { notFound } from "next/navigation";
import { getCustomerDetail } from "@/lib/customers/admin";
import { CustomerDetail } from "@/components/admin/customer-detail";
import { AdminBackLink } from "@/components/admin/admin-back-link";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <AdminBackLink href="/admin/customers" label="Customers" />
      <CustomerDetail detail={detail} />
    </div>
  );
}
