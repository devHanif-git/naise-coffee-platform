"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { BeanActivity } from "@/types/reward";
import { beansPerRinggit, rewardsSummary } from "@/data/rewards";

const BALANCE_KEY = "naise-beans-balance";
const ACTIVITY_KEY = "naise-beans-activity";

// One reward redeemed in an order, settled at checkout.
type RedeemedReward = {
  name: string;
  cost: number;
};

// What an order contributes to the Beans ledger: beans earned on the paid total
// and any rewards redeemed (whose costs are deducted). Computed by the caller
// from the cart; the store applies it atomically.
type OrderBeans = {
  // Amount due in sen — beans are earned on this (paid) portion only.
  paidTotal: number;
  rewards: RedeemedReward[];
};

type BeansContextValue = {
  // True once the persisted balance/activity have loaded from localStorage.
  hydrated: boolean;
  balance: number;
  activity: BeanActivity[];
  // Beans earned per RM1 spent — exposed so callers can preview the earn.
  earnRate: number;
  // Applies an order to the ledger: deducts redeemed reward costs, credits
  // beans earned on the paid total, and prepends activity entries. Returns the
  // resulting balance. Caller must check `canAfford` first — this assumes the
  // redemption was already validated.
  spendAndEarn: (order: OrderBeans) => number;
  // Credits a flat amount of Beans with a labelled activity entry — for grants
  // outside the order flow (streak milestones, referrals). No-op for amounts <= 0.
  creditBeans: (amount: number, label: string) => void;
  // Whether the current balance covers a Bean cost (e.g. a reward at checkout).
  canAfford: (cost: number) => boolean;
};

const BeansContext = createContext<BeansContextValue | null>(null);

// Beans earned on a paid total (sen). 10 beans per whole RM by default.
function beansEarned(paidTotalSen: number): number {
  return Math.floor((paidTotalSen / 100) * beansPerRinggit);
}

export function BeansProvider({ children }: { children: React.ReactNode }) {
  // Start from the mock snapshot so the first render matches the server-rendered
  // rewards screens; real values load from storage in the effect below.
  const [balance, setBalance] = useState(rewardsSummary.beans);
  const [activity, setActivity] = useState<BeanActivity[]>(
    rewardsSummary.activity,
  );
  const [hydrated, setHydrated] = useState(false);

  // Load persisted ledger once on mount (effect, not lazy initializer) so the
  // first client render matches the server's mock values and avoids a hydration
  // mismatch — same approach as the cart/streak stores.
  useEffect(() => {
    try {
      const rawBalance = localStorage.getItem(BALANCE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
      if (rawBalance !== null) setBalance(Number(rawBalance) || 0);
      const rawActivity = localStorage.getItem(ACTIVITY_KEY);
      if (rawActivity) setActivity(JSON.parse(rawActivity) as BeanActivity[]);
    } catch {
      // Ignore malformed/unavailable storage; keep the mock starting values.
    }
    setHydrated(true);
  }, []);

  // Persist after the initial load so we never clobber stored values with the
  // mock starting state.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(BALANCE_KEY, String(balance));
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
    } catch {
      // Storage may be full/unavailable; ledger still works in-memory.
    }
  }, [balance, activity, hydrated]);

  const spendAndEarn = useCallback((order: OrderBeans) => {
    const earned = beansEarned(order.paidTotal);
    const spent = order.rewards.reduce((sum, r) => sum + r.cost, 0);

    // Newest first, matching the activity feed. Redemptions are negative.
    const entries: BeanActivity[] = [];
    for (const reward of order.rewards) {
      entries.push({
        id: crypto.randomUUID(),
        amount: -reward.cost,
        label: `Redeemed ${reward.name}`,
        when: "Today",
      });
    }
    if (earned > 0) {
      entries.push({
        id: crypto.randomUUID(),
        amount: earned,
        label: "Order earnings",
        when: "Today",
      });
    }

    // Functional updates so this composes with other ledger writes in the same
    // tick (e.g. a streak milestone credited right after checkout) instead of
    // one clobbering the other.
    setBalance((prev) => prev - spent + earned);
    setActivity((prev) => [...entries, ...prev]);
    return balance - spent + earned;
  }, [balance]);

  // Credits a flat amount of Beans with a labelled activity entry. Used for
  // grants outside the order flow — streak milestones, referrals, etc. No-op for
  // non-positive amounts. Functional updates so it stacks with a concurrent
  // spendAndEarn in the same tick.
  const creditBeans = useCallback((amount: number, label: string) => {
    if (amount <= 0) return;
    setBalance((prev) => prev + amount);
    setActivity((prev) => [
      { id: crypto.randomUUID(), amount, label, when: "Today" },
      ...prev,
    ]);
  }, []);

  const canAfford = useCallback((cost: number) => balance >= cost, [balance]);

  const value = useMemo<BeansContextValue>(
    () => ({
      hydrated,
      balance,
      activity,
      earnRate: beansPerRinggit,
      spendAndEarn,
      creditBeans,
      canAfford,
    }),
    [hydrated, balance, activity, spendAndEarn, creditBeans, canAfford],
  );

  return <BeansContext.Provider value={value}>{children}</BeansContext.Provider>;
}

export function useBeans(): BeansContextValue {
  const ctx = useContext(BeansContext);
  if (!ctx) throw new Error("useBeans must be used within a BeansProvider");
  return ctx;
}
