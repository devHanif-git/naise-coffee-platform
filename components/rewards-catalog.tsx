"use client";

import Image from "next/image";
import Link from "next/link";
import { rewardsCatalog } from "@/data/rewards";
import { useBeans } from "@/store/beans";

// Client view of the rewards catalogue. Reads the live Beans balance so the
// "to spend" figure and each reward's affordability match the persisted ledger;
// falls back to the mock balance until the store hydrates (matching the
// server-rendered HTML to avoid a mismatch). The reward list itself is static
// mock content for now.
export function RewardsCatalog() {
  const { balance } = useBeans();
  const beans = balance;
  const rewards = rewardsCatalog;

  return (
    <main className="px-5 pb-8 pt-2">
      <p className="text-sm text-muted-foreground naise-rise">
        You have{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {beans.toLocaleString()} Beans
        </span>{" "}
        to spend.
      </p>

      <ul className="mt-4 grid grid-cols-2 gap-3">
        {rewards.map((reward, i) => {
          const affordable = beans >= reward.cost;
          return (
            <li
              key={reward.id}
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm naise-rise"
              style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            >
              <div className="relative flex aspect-square items-center justify-center bg-[radial-gradient(circle_at_50%_36%,_#f4ede4,_#ffffff_72%)]">
                <Image
                  src={reward.image}
                  alt={reward.name}
                  fill
                  sizes="(max-width: 768px) 50vw, 200px"
                  className="object-contain p-4"
                />
              </div>
              <div className="px-3 pb-3 pt-2.5 text-center">
                <h2 className="text-xs font-bold leading-snug">{reward.name}</h2>
                <p className="mt-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">
                  {reward.cost.toLocaleString()} Beans
                </p>
                {affordable ? (
                  <Link
                    href={`/menu/${reward.productSlug}?reward=${reward.id}`}
                    className="mt-2.5 flex h-8 w-full items-center justify-center rounded-full bg-black text-[0.6875rem] font-semibold uppercase tracking-wide text-white outline-none transition-transform hover:scale-[1.02] active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Redeem
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="mt-2.5 h-8 w-full rounded-full bg-black text-[0.6875rem] font-semibold uppercase tracking-wide text-white outline-none cursor-not-allowed opacity-40"
                  >
                    Redeem
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
