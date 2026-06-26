"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerSummary } from "@/lib/customers/types";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-foreground text-background",
  manager: "bg-foreground/10 text-foreground",
  staff: "bg-muted text-foreground",
  customer: "bg-muted text-muted-foreground",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-semibold capitalize",
        ROLE_STYLE[role] ?? ROLE_STYLE.customer,
      )}
    >
      {role}
    </span>
  );
}

function Avatar({ name }: { name: string | null }) {
  const initial = name?.trim()?.[0]?.toUpperCase() ?? "?";
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-heading text-sm font-bold text-muted-foreground">
      {initial}
    </span>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm">
      <span className="font-mono font-bold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
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

  const totalOrders = initial.reduce((s, c) => s + c.ordersCount, 0);
  const totalBeans = initial.reduce((s, c) => s + c.beansBalance, 0);
  const teamCount = initial.filter((c) => c.role !== "customer").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Shop-wide totals at a glance. */}
      <div className="flex flex-wrap items-center gap-2">
        <Stat value={String(initial.length)} label="people" />
        <Stat value={totalOrders.toLocaleString()} label="orders" />
        <Stat value={totalBeans.toLocaleString()} label="Beans held" />
        <Stat value={String(teamCount)} label="team" />
      </div>

      <SearchInput
        value={term}
        onValueChange={setTerm}
        placeholder="Search name or phone"
        aria-label="Search customers by name or phone"
        containerClassName="max-w-sm"
        className="h-10 rounded-full"
      />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-12 text-center text-sm text-muted-foreground">
          No customers found.
        </div>
      ) : (
        <>
          {/* Desktop table (md+) */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-4 py-3 text-left font-semibold">Customer</th>
                  <th className="px-4 py-3 text-left font-semibold">Phone</th>
                  <th className="px-4 py-3 text-left font-semibold">Role</th>
                  <th className="px-4 py-3 text-right font-semibold">Orders</th>
                  <th className="px-4 py-3 text-right font-semibold">Beans</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/customers/${c.id}`}
                        className="group flex items-center gap-3 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <Avatar name={c.displayName} />
                        <span className="truncate font-semibold group-hover:underline">
                          {c.displayName ?? "(no name)"}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                      {c.phone ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <RoleBadge role={c.role} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {c.ordersCount}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-medium tabular-nums">
                      {c.beansBalance.toLocaleString()}
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
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Avatar name={c.displayName} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">
                      {c.displayName ?? "(no name)"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.phone ?? "—"} ·{" "}
                      <span className="font-mono tabular-nums">{c.ordersCount}</span> orders
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-sm font-medium tabular-nums">
                      {c.beansBalance.toLocaleString()}
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
