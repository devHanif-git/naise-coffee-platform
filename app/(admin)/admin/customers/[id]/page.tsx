import { notFound } from "next/navigation";
import { getCustomerDetail } from "@/lib/customers/admin";
import { CustomerDetail } from "@/components/admin/customer-detail";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();
  return <CustomerDetail detail={detail} />;
}
