"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerDetail } from "@/lib/customers/types";
import type { Role } from "@/types/auth";
import { formatPrice, formatOrderTime } from "@/lib/format";
import { setCustomerRole, adjustCustomerBeans } from "@/app/(admin)/admin/customers/actions";

const ROLES: Role[] = ["customer", "staff", "manager", "admin"];

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
    <div className="flex flex-col gap-4">
      {/* Identity + balance */}
      <section className="rounded-2xl border border-border p-4">
        <h2 className="text-base font-bold">{summary.displayName ?? "(no name)"}</h2>
        <p className="text-xs text-muted-foreground">
          {summary.phone ?? "—"} · joined {formatOrderTime(summary.joinedAt)}
        </p>
        <p className="mt-2 text-sm">
          <span className="font-semibold">{summary.beansBalance}</span> Beans ·{" "}
          <span className="font-semibold">{summary.ordersCount}</span> orders
        </p>
      </section>

      {/* Role assignment */}
      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">Role</h3>
        <div className="flex items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="rounded-2xl border border-border px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            onClick={saveRole}
            disabled={rolePending || role === summary.role}
            className="rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {rolePending ? "Saving…" : "Save role"}
          </button>
        </div>
        {roleMsg && (
          <p className={roleMsg.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{roleMsg.text}</p>
        )}
      </section>

      {/* Beans adjustment */}
      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">Adjust Beans</h3>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setBeansMsg(null); }}
          placeholder="Amount (e.g. 100 or -50)"
          className="rounded-2xl border border-border px-3 py-2 text-sm"
        />
        <input
          value={reason}
          onChange={(e) => { setReason(e.target.value); setBeansMsg(null); }}
          placeholder="Reason (required)"
          className="rounded-2xl border border-border px-3 py-2 text-sm"
        />
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={!validAmount || !reason.trim()}
            className="self-start rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Adjust
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {parsedAmount > 0 ? "Grant" : "Deduct"} {Math.abs(parsedAmount)} Beans?
            </span>
            <button
              onClick={applyBeans}
              disabled={beansPending}
              className="rounded-2xl bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {beansPending ? "Applying…" : "Confirm"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={beansPending}
              className="rounded-2xl border border-border px-3 py-1.5 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        )}
        {beansMsg && (
          <p className={beansMsg.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{beansMsg.text}</p>
        )}
      </section>

      {/* Order history */}
      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">Orders</h3>
        {orders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}
        {orders.map((o) => (
          <div key={o.id} className="flex items-center justify-between text-sm">
            <span className="font-medium">{o.orderNumber}</span>
            <span className="text-muted-foreground">{o.status}</span>
            <span>{formatPrice(o.total)}</span>
          </div>
        ))}
      </section>

      {/* Beans ledger */}
      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">Beans ledger</h3>
        {ledger.length === 0 && <p className="text-sm text-muted-foreground">No Beans activity yet.</p>}
        {ledger.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-sm">
            <span className="truncate">{t.label}</span>
            <span className={t.amount >= 0 ? "text-emerald-600" : "text-rose-600"}>
              {t.amount >= 0 ? "+" : ""}{t.amount}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
