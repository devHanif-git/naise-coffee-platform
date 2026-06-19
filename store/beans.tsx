"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { BeanActivity } from "@/types/reward";
import { beansPerRinggit } from "@/data/rewards";
import { createClient } from "@/lib/supabase/client";

// How many recent ledger rows to load for the activity feed. The full feed lives
// at /rewards/activity; this is plenty for the previews and that page.
const ACTIVITY_LIMIT = 50;

type BeansContextValue = {
  // True once the member's rewards have loaded (or we've confirmed a guest).
  hydrated: boolean;
  balance: number;
  // Lifetime Beans earned (earn-only) — drives the loyalty tier.
  lifetimeEarned: number;
  activity: BeanActivity[];
  // Beans earned per RM1 spent — exposed so callers can preview the earn.
  earnRate: number;
  // Advisory: whether the current balance covers a Bean cost. The authoritative
  // check is server-side in apply_order_rewards.
  canAfford: (cost: number) => boolean;
};

const BeansContext = createContext<BeansContextValue | null>(null);

// Local-day label for a ledger row's created_at: "Today" / "Yesterday" / "12 Jun"
// in Kuala Lumpur time. Runs only after hydration (client-side), so no SSR drift.
function whenLabel(iso: string): string {
  const tz = "Asia/Kuala_Lumpur";
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const key = dayKey(new Date(iso));
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function BeansProvider({ children }: { children: React.ReactNode }) {
  const [balance, setBalance] = useState(0);
  const [lifetimeEarned, setLifetimeEarned] = useState(0);
  const [activity, setActivity] = useState<BeanActivity[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    let channel: RealtimeChannel | null = null;
    const supabase = createClient();

    async function load(userId: string) {
      const [{ data: account }, { data: txns }] = await Promise.all([
        supabase
          .from("reward_accounts")
          .select("balance, lifetime_earned")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("bean_transactions")
          .select("id, amount, label, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
      ]);
      if (!active) return;
      setBalance(account?.balance ?? 0);
      setLifetimeEarned(account?.lifetime_earned ?? 0);
      setActivity(
        (txns ?? []).map((t) => ({
          id: t.id,
          amount: t.amount,
          label: t.label,
          when: whenLabel(t.created_at),
        })),
      );
    }

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) {
        setHydrated(true);
        return;
      }
      await load(user.id);
      if (!active) return;
      setHydrated(true);

      // Live updates: the member's own reward_accounts row changes whenever the
      // ledger is written (the txn trigger updates it). Refetch on any change.
      //
      // The `active` guards after each await matter: React strict-mode mounts the
      // provider twice, and without them a torn-down mount would still run past
      // its awaits and build a SECOND channel on the same `rewards:<uid>` topic.
      // Supabase then throws "cannot add postgres_changes callbacks after
      // subscribe()" — the error that was crashing every customer page. Now only
      // the live mount ever creates/subscribes a channel, and cleanup removes it.
      const rewardsChannel = supabase
        .channel(`rewards:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "reward_accounts",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void load(user.id);
          },
        );
      channel = rewardsChannel;

      await supabase.realtime.setAuth();
      if (!active) {
        // Cleaned up while refreshing realtime auth — drop the channel unsubscribed.
        void supabase.removeChannel(rewardsChannel);
        channel = null;
        return;
      }
      rewardsChannel.subscribe();
    })();

    return () => {
      active = false;
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, []);

  const canAfford = useCallback((cost: number) => balance >= cost, [balance]);

  const value = useMemo<BeansContextValue>(
    () => ({
      hydrated,
      balance,
      lifetimeEarned,
      activity,
      earnRate: beansPerRinggit,
      canAfford,
    }),
    [hydrated, balance, lifetimeEarned, activity, canAfford],
  );

  return <BeansContext.Provider value={value}>{children}</BeansContext.Provider>;
}

export function useBeans(): BeansContextValue {
  const ctx = useContext(BeansContext);
  if (!ctx) throw new Error("useBeans must be used within a BeansProvider");
  return ctx;
}
