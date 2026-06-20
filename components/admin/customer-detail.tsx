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

  return (
    <div className="flex flex-col gap-6">
      <AdminBackLink href="/admin/customers" label="Back to Customers" />
      <h1 className="font-heading text-xl font-bold tracking-tight">
        {summary.displayName ?? "(no name)"}
      </h1>

      <div className="flex flex-col gap-4">
        {/* Identity + balance */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-base font-semibold">
            {summary.displayName ?? "(no name)"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {summary.phone ?? "-"} · joined {formatOrderTime(summary.joinedAt)}
          </p>
          <p className="mt-2 text-sm">
            <span className="font-mono font-semibold tabular-nums">
              {summary.beansBalance}
            </span>{" "}
            Beans ·{" "}
            <span className="font-mono font-semibold tabular-nums">
              {summary.ordersCount}
            </span>{" "}
            orders
          </p>
        </section>

        {/* Role assignment */}
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading text-base font-semibold">Role</h3>
          <div className="flex items-center gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className={SELECT_CLASS}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={saveRole}
              disabled={rolePending || role === summary.role}
            >
              {rolePending ? "Saving..." : "Save role"}
            </Button>
          </div>
          {roleMsg && (
            <p className={roleMsg.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>
              {roleMsg.text}
            </p>
          )}
        </section>

        {/* Beans adjustment */}
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading text-base font-semibold">Adjust Beans</h3>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setBeansMsg(null); }}
            placeholder="Amount (e.g. 100 or -50)"
            className="h-10"
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
              className="self-start"
              onClick={() => setConfirming(true)}
              disabled={!validAmount || !reason.trim()}
            >
              Adjust
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm">
                {parsedAmount > 0 ? "Grant" : "Deduct"}{" "}
                <span className="font-mono tabular-nums">
                  {Math.abs(parsedAmount)}
                </span>{" "}
                Beans?
              </span>
              <Button size="sm" onClick={applyBeans} disabled={beansPending}>
                {beansPending ? "Applying..." : "Confirm"}
              </Button>
              <Button
                size="sm"
                variant="outline"
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

        {/* Order history */}
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading text-base font-semibold">Orders</h3>
          {orders.length === 0 && (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          )}
          {orders.map((o) => (
            <div key={o.id} className="flex items-center justify-between text-sm">
              <span className="font-medium">{o.orderNumber}</span>
              <span className="text-muted-foreground">{o.status}</span>
              <span className="font-mono tabular-nums">{formatPrice(o.total)}</span>
            </div>
          ))}
        </section>

        {/* Beans ledger */}
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading text-base font-semibold">Beans ledger</h3>
          {ledger.length === 0 && (
            <p className="text-sm text-muted-foreground">No Beans activity yet.</p>
          )}
          {ledger.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-sm">
              <span className="truncate">{t.label}</span>
              <span
                className={
                  t.amount >= 0
                    ? "font-mono tabular-nums text-emerald-600"
                    : "font-mono tabular-nums text-destructive"
                }
              >
                {t.amount >= 0 ? "+" : ""}{t.amount}
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
