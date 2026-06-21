import { listCustomers } from "@/lib/customers/admin";
import { CustomersList } from "@/components/admin/customers-list";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await listCustomers();
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Customers" description="Everyone who has ordered." />
      <CustomersList initial={customers} />
    </div>
  );
}
