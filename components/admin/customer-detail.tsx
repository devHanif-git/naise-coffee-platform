"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerDetail } from "@/lib/customers/types";
import type { Role } from "@/types/auth";
import { formatPrice, formatOrderTime } from "@/lib/format";
import { setCustomerRole, adjustCustomerBeans } from "@/app/(admin)/admin/customers/actions";
import { AdminBackLink } from "@/components/admin/admin-back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ROLES: Role[] = ["customer", "staff", "manager", "admin"];

const SELECT_CLASS =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const ORDER_STATUS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600",
  preparing: "bg-blue-500/15 text-blue-600",
  ready: "bg-emerald-500/15 text-emerald-600",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

export function CustomerDetail({ detail }: { detail: CustomerDetail }) {
  const router = useRouter();
  const { summary, orders, ledger } = detail;

  const [role, setRole] = useState<Role>(summary.role);
  const [roleMsg, setRoleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rolePending, startRole] = useTransition();

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const parsedAmount = Number(amount);
  const validAmount = Number.isInteger(parsedAmount) && parsedAmount !== 0;
  const [confirming, setConfirming] = useState(false);
  const [beansMsg, setBeansMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [beansPending, startBeans] = useTransition();

  function saveRole() {
    setRoleMsg(null);
    startRole(async () => {
      const res = await setCustomerRole(summary.id, role);
      if (res.ok) {
        setRoleMsg({ ok: true, text: "Role updated." });
        router.refresh();
      } else {
        setRole(summary.role); // revert the picker on failure
        setRoleMsg({ ok: false, text: res.error });
      }
    });
  }

  function applyBeans() {
    setBeansMsg(null);
    startBeans(async () => {
      const res = await adjustCustomerBeans(summary.id, Number(amount), reason);
      if (res.ok) {
        setBeansMsg({ ok: true, text: `Done. New balance: ${res.balance} Beans.` });
        setAmount("");
        setReason("");
        setConfirming(false);
        router.refresh();
      } else {
        setBeansMsg({ ok: false, text: res.error });
        setConfirming(false);
      }
    });
  }

  const initial = summary.displayName?.trim()?.[0]?.toUpperCase() ?? "?";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <AdminBackLink href="/admin/customers" label="Back to Customers" />

      {/* Identity + balance hero. */}
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted font-heading text-xl font-bold text-muted-foreground">
            {initial}
          </span>
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate font-heading text-xl font-bold tracking-tight">
              {summary.displayName ?? "(no name)"}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {summary.phone ?? "—"} · joined {formatOrderTime(summary.joinedAt)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <div className="flex flex-col items-end rounded-xl border border-border px-4 py-2">
            <span className="font-mono text-lg font-bold tabular-nums">
              {summary.beansBalance.toLocaleString()}
            </span>
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Beans
            </span>
          </div>
          <div className="flex flex-col items-end rounded-xl border border-border px-4 py-2">
            <span className="font-mono text-lg font-bold tabular-nums">
              {summary.ordersCount}
            </span>
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Orders
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Role assignment */}
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-heading text-base font-semibold">Role</h2>
          <div className="flex items-center gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className={`${SELECT_CLASS} flex-1 capitalize`}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <Button
              size="sm"
              className="rounded-full"
              onClick={saveRole}
              disabled={rolePending || role === summary.role}
            >
              {rolePending ? "Saving..." : "Save"}
            </Button>
          </div>
          {roleMsg && (
            <p className={roleMsg.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>
              {roleMsg.text}
            </p>
          )}
        </section>

        {/* Beans adjustment */}
        <section className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-heading text-base font-semibold">Adjust Beans</h2>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setBeansMsg(null); }}
            placeholder="Amount (e.g. 100 or -50)"
            className="h-10 font-mono tabular-nums"
          />
          <Input
            value={reason}
            onChange={(e) => { setReason(e.target.value); setBeansMsg(null); }}
            placeholder="Reason (required)"
            className="h-10"
          />
          {!confirming ? (
            <Button
              size="sm"
              className="self-start rounded-full"
              onClick={() => setConfirming(true)}
              disabled={!validAmount || !reason.trim()}
            >
              Adjust
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                {parsedAmount > 0 ? "Grant" : "Deduct"}{" "}
                <span className="font-mono tabular-nums">
                  {Math.abs(parsedAmount)}
                </span>{" "}
                Beans?
              </span>
              <Button size="sm" className="rounded-full" onClick={applyBeans} disabled={beansPending}>
                {beansPending ? "Applying..." : "Confirm"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => setConfirming(false)}
                disabled={beansPending}
              >
                Cancel
              </Button>
            </div>
          )}
          {beansMsg && (
            <p className={beansMsg.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>
              {beansMsg.text}
            </p>
          )}
        </section>
      </div>

      {/* Order history */}
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base font-semibold">Orders</h2>
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {orders.length} total
          </span>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {orders.map((o) => (
              <div key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {o.orderNumber}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold capitalize ${ORDER_STATUS[o.status] ?? ORDER_STATUS.completed}`}
                >
                  {o.status}
                </span>
                <span className="ml-auto font-mono font-medium tabular-nums">
                  {formatPrice(o.total)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Beans ledger */}
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base font-semibold">Beans ledger</h2>
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {ledger.length} entries
          </span>
        </div>
        {ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Beans activity yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {ledger.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="truncate">{t.label}</span>
                <span
                  className={
                    t.amount >= 0
                      ? "shrink-0 font-mono font-medium tabular-nums text-emerald-600"
                      : "shrink-0 font-mono font-medium tabular-nums text-destructive"
                  }
                >
                  {t.amount >= 0 ? "+" : ""}{t.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
