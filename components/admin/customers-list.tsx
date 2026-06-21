"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerSummary } from "@/lib/customers/types";
import { Input } from "@/components/ui/input";

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-primary text-primary-foreground",
  manager: "bg-primary/10 text-primary",
  staff: "bg-muted text-foreground",
  customer: "bg-muted text-muted-foreground",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_STYLE[role] ?? ROLE_STYLE.customer}`}
    >
      {role}
    </span>
  );
}

export function CustomersList({ initial }: { initial: CustomerSummary[] }) {
  const [term, setTerm] = useState("");
  const t = term.trim().toLowerCase();
  const rows = !t
    ? initial
    : initial.filter(
        (c) =>
          (c.displayName?.toLowerCase().includes(t) ?? false) ||
          (c.phone?.toLowerCase().includes(t) ?? false),
      );

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search name or phone"
        aria-label="Search customers by name or phone"
        className="h-10 max-w-sm"
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No customers found.
        </div>
      ) : (
        <>
          {/* Desktop table (md+) */}
          <div className="hidden overflow-hidden rounded-xl border border-border md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 text-left font-medium">Customer</th>
                  <th className="px-3 py-2.5 text-left font-medium">Phone</th>
                  <th className="px-3 py-2.5 text-left font-medium">Role</th>
                  <th className="px-3 py-2.5 text-right font-medium">Orders</th>
                  <th className="px-3 py-2.5 text-right font-medium">Beans</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/admin/customers/${c.id}`}
                        className="block truncate rounded-sm font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {c.displayName ?? "(no name)"}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {c.phone ?? "-"}
                    </td>
                    <td className="px-3 py-2.5">
                      <RoleBadge role={c.role} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {c.ordersCount}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {c.beansBalance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards (below md) */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/admin/customers/${c.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold">
                      {c.displayName ?? "(no name)"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.phone ?? "-"} ·{" "}
                      <span className="font-mono tabular-nums">
                        {c.ordersCount}
                      </span>{" "}
                      orders
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-medium">
                      <span className="font-mono tabular-nums">
                        {c.beansBalance}
                      </span>{" "}
                      🫘
                    </span>
                    <RoleBadge role={c.role} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
