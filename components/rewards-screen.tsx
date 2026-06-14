"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronLeft,
  HelpCircle,
  Gift,
  Flame,
  ChevronRight,
  Check,
  Plus,
  Minus,
} from "lucide-react";
import type { RewardsSummary } from "@/types/reward";
import { rewardTiers, RECENT_ACTIVITY_LIMIT } from "@/data/rewards";
import { RewardsInfoModal } from "@/components/rewards-info-modal";
import { RewardsTiersModal } from "@/components/rewards-tiers-modal";
import { images } from "@/constants/images";
import { cn } from "@/lib/utils";

// The full Rewards screen. Client component because it owns the info-modal
// state and the "?" trigger. Data is passed in (mocked today, server-fetched
// once the Supabase rewards tables land). Mobile-first: the layout targets the
// app's max-w-md shell, scaling type/spacing up at sm.
export function RewardsScreen({ data }: { data: RewardsSummary }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [tiersOpen, setTiersOpen] = useState(false);
  const rewardsRef = useRef<HTMLElement>(null);

  const toDrink = Math.max(0, data.nextDrinkAt - data.beans);
  const drinkPct = Math.min(100, Math.round((data.beans / data.nextDrinkAt) * 100));
  const tierPct = Math.min(100, Math.round((data.beans / data.tierMax) * 100));
  const toNextTier = Math.max(0, data.tierMax - data.beans);

  return (
    <div className="flex flex-col">
      {/* Header — light, matching the design. Back returns to Home; "?" opens
          the program explainer. */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href="/home"
          aria-label="Go back"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-sm font-bold uppercase tracking-[0.25em]">
          Rewards
        </h1>
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          aria-label="How rewards work"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <HelpCircle className="size-6" strokeWidth={2} aria-hidden />
        </button>
      </header>

      <main className="flex flex-col gap-8 px-5 pb-8 pt-2">
        {/* Hero — Beans balance, progress to next free drink, primary CTA.
            The mug bleeds off the bottom-right corner as a product shot; all
            content sits in a constrained left column so nothing overlaps it. */}
        <section
          aria-labelledby="beans-balance"
          className="relative overflow-hidden rounded-[1.75rem] bg-black px-6 py-7 text-white"
        >
          <Image
            src={images.latteArt}
            alt=""
            width={320}
            height={320}
            aria-hidden
            className="pointer-events-none absolute -bottom-2 -right-4 z-0 h-auto w-40 object-contain sm:w-48"
          />

          <div className="relative z-10 flex max-w-[60%] flex-col">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-white/60">
              Naise Rewards
            </p>
            <p
              id="beans-balance"
              className="mt-2 font-heading text-6xl font-bold leading-none tracking-tight tabular-nums"
            >
              {data.beans.toLocaleString()}
              <span className="ml-2 align-baseline text-lg font-medium text-white/80">
                Beans
              </span>
            </p>
            <p className="mt-3 text-[0.8125rem] leading-snug text-white/70">
              <span className="font-semibold text-white">{toDrink.toLocaleString()}</span>{" "}
              more Beans to your{" "}
              <span className="font-heading font-bold uppercase tracking-wide text-white">
                Free Drink
              </span>
            </p>

            <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-white/80 to-white transition-[width] duration-500"
                style={{ width: `${drinkPct}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[0.6875rem] font-medium text-white/55 tabular-nums">
              <span>{data.beans.toLocaleString()}</span>
              <span>{data.nextDrinkAt.toLocaleString()}</span>
            </div>

            <button
              type="button"
              onClick={() =>
                rewardsRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
              className="mt-6 inline-flex h-11 w-fit items-center gap-2 rounded-full bg-white px-6 text-xs font-semibold uppercase tracking-[0.12em] text-black outline-none transition-transform hover:scale-[1.02] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-white/40"
            >
              <Gift className="size-4" strokeWidth={2} aria-hidden />
              View Rewards
            </button>
          </div>
        </section>

        {/* Streak + Tier summary row. */}
        <section className="grid grid-cols-2">
          <div className="min-w-0 pr-5">
            <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
              <Flame className="size-4 text-foreground" strokeWidth={2.5} aria-hidden />
              Your Streak
            </p>
            <p className="mt-1.5 font-heading text-2xl font-bold tracking-tight">
              {data.streakDays} <span className="font-medium">Days</span>
            </p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              Buy coffee tomorrow to keep your streak alive.
            </p>
          </div>

          <div className="min-w-0 border-l border-border pl-5">
            <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
              Your Tier
            </p>
            <p className="mt-1.5 font-heading text-2xl font-bold tracking-tight">
              {data.tier}
            </p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {data.beans.toLocaleString()} / {data.tierMax.toLocaleString()} Beans
            </p>
          </div>
        </section>

        {/* Weekly stamp card — earned days are filled checks, upcoming are
            dashed outlines. */}
        <section aria-label="Weekly streak" className="-mt-3">
          <ul className="flex justify-between">
            {data.week.map((day) => (
              <li key={day.label} className="flex flex-col items-center gap-1.5">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full",
                    day.done
                      ? "bg-black text-white"
                      : "border-2 border-dashed border-neutral-300 text-transparent",
                  )}
                >
                  <Check className="size-4" strokeWidth={3} aria-hidden />
                </span>
                <span
                  className={cn(
                    "text-[0.625rem] font-medium",
                    day.done ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {day.label}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-stretch overflow-hidden rounded-2xl border border-border">
            {data.milestones.map((m, i) => (
              <div
                key={m.days}
                className={cn(
                  "flex-1 px-3 py-3 text-center",
                  i > 0 && "border-l border-border",
                )}
              >
                <p className="text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
                  {m.days} Days
                </p>
                <p className="mt-1 text-sm font-semibold">{m.reward}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Tier progress + tiers CTA. */}
        <section aria-label="Tier progress" className="-mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full rounded-full bg-black transition-[width] duration-500"
              style={{ width: `${tierPct}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            You&apos;re {toNextTier.toLocaleString()} Beans away from {data.nextTier} tier.
          </p>
          <button
            type="button"
            onClick={() => setTiersOpen(true)}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            View Tiers
          </button>
        </section>

        {/* Available rewards — horizontal scroll of redeemable drinks. */}
        <section
          ref={rewardsRef}
          aria-labelledby="available-rewards"
          id="available-rewards"
          className="scroll-mt-20"
        >
          <div className="flex items-center justify-between">
            <h2
              id="available-rewards-heading"
              className="text-xs font-bold uppercase tracking-wide"
            >
              Available Rewards
            </h2>
            <Link
              href="/rewards/catalog"
              className="flex items-center gap-0.5 text-[0.6875rem] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
            >
              See all
              <ChevronRight className="size-3.5" strokeWidth={2.5} aria-hidden />
            </Link>
          </div>

          <ul className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {data.rewards.map((reward) => {
              const affordable = data.beans >= reward.cost;
              return (
                <li
                  key={reward.id}
                  className="w-36 shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  <div className="relative flex aspect-square items-center justify-center bg-[radial-gradient(circle_at_50%_36%,_#f4ede4,_#ffffff_72%)]">
                    <Image
                      src={reward.image}
                      alt={reward.name}
                      fill
                      sizes="144px"
                      className="object-contain p-4"
                    />
                  </div>
                  <div className="px-3 pb-3 pt-2.5 text-center">
                    <h3 className="text-xs font-bold leading-snug">{reward.name}</h3>
                    <p className="mt-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">
                      {reward.cost.toLocaleString()} Beans
                    </p>
                    <button
                      type="button"
                      disabled={!affordable}
                      className="mt-2.5 h-8 w-full rounded-full bg-black text-[0.6875rem] font-semibold uppercase tracking-wide text-white outline-none transition-transform hover:scale-[1.02] active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                    >
                      Redeem
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Invite friends. */}
        <section aria-labelledby="invite-heading">
          <div className="relative overflow-hidden rounded-[1.5rem] bg-black px-5 py-6 text-white">
            <Image
              src={images.celebration}
              alt=""
              width={200}
              height={200}
              aria-hidden
              className="pointer-events-none absolute -bottom-1 -right-2 z-0 h-auto w-36 object-contain sm:w-40"
            />
            <div className="relative z-10 max-w-[62%]">
              <p
                id="invite-heading"
                className="text-[0.625rem] font-semibold uppercase tracking-[0.2em] text-white/60"
              >
                Invite Friends
              </p>
              <p className="mt-2 text-sm text-white/70">You get</p>
              <p className="font-heading text-3xl font-bold tracking-tight">
                {data.referralBeans} Beans
              </p>
              <p className="mt-1 text-sm text-white/70">
                Friend gets <span className="font-semibold text-white">{data.referralVoucher}</span>
              </p>
              <button
                type="button"
                className="mt-4 h-10 rounded-full bg-white px-5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-black outline-none transition-transform hover:scale-[1.02] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-white/40"
              >
                Share Referral
              </button>
            </div>
          </div>
        </section>

        {/* Recent activity. */}
        <section
          id="activity"
          aria-labelledby="activity-heading"
          className="scroll-mt-20"
        >
          <div className="flex items-center justify-between">
            <h2
              id="activity-heading"
              className="text-xs font-bold uppercase tracking-wide"
            >
              Recent Activity
            </h2>
            <Link
              href="/rewards/activity"
              className="flex items-center gap-0.5 text-[0.6875rem] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
            >
              See all
              <ChevronRight className="size-3.5" strokeWidth={2.5} aria-hidden />
            </Link>
          </div>

          <ul className="mt-3 flex flex-col divide-y divide-border rounded-2xl border border-border">
            {data.activity.slice(0, RECENT_ACTIVITY_LIMIT).map((item) => {
              const earned = item.amount > 0;
              return (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      earned ? "bg-black text-white" : "bg-neutral-100 text-foreground",
                    )}
                  >
                    {earned ? (
                      <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
                    ) : (
                      <Minus className="size-3.5" strokeWidth={2.5} aria-hidden />
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="text-sm font-bold tabular-nums">
                      {Math.abs(item.amount)}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {item.label}
                    </span>
                  </div>
                  <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                    {item.when}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      {infoOpen && <RewardsInfoModal onClose={() => setInfoOpen(false)} />}
      {tiersOpen && (
        <RewardsTiersModal
          tiers={rewardTiers}
          beans={data.beans}
          onClose={() => setTiersOpen(false)}
        />
      )}
    </div>
  );
}
