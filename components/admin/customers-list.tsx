"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerSummary } from "@/lib/customers/types";

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-black text-white",
  manager: "bg-indigo-100 text-indigo-800",
  staff: "bg-amber-100 text-amber-800",
  customer: "bg-neutral-100 text-neutral-700",
};

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
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search name or phone"
        className="rounded-2xl border border-border px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-black/20"
      />
      <ul className="flex flex-col gap-2">
        {rows.map((c) => (
          <li key={c.id}>
            <Link
              href={`/admin/customers/${c.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3 transition-colors hover:bg-muted"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">
                  {c.displayName ?? "(no name)"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {c.phone ?? "—"} · {c.ordersCount} orders
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{c.beansBalance} 🫘</span>
                <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${ROLE_STYLE[c.role] ?? ROLE_STYLE.customer}`}>
                  {c.role}
                </span>
              </div>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No customers found.
          </li>
        )}
      </ul>
    </div>
  );
}
