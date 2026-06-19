import { listCustomers } from "@/lib/customers/admin";
import { CustomersList } from "@/components/admin/customers-list";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await listCustomers();
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Customers</h1>
      <CustomersList initial={customers} />
    </div>
  );
}
