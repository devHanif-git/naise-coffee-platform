"use client";

import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  LogIn,
  LogOut,
  Pencil,
  Settings,
  Star,
} from "lucide-react";
import type { Order } from "@/types/order";
import { getTierProgress } from "@/data/rewards";
import { useAuth } from "@/store/auth";
import { useBeans } from "@/store/beans";
import { useProfile } from "@/store/profile";
import { ProfileAvatar } from "@/components/profile-avatar";
import { CustomerOrderCard } from "@/components/customer-order-card";

// Member-since label, e.g. "Member since Sep 2025". Locale/timeZone pinned so
// the edge server (UTC) and client render identical text (no hydration drift).
function memberSinceLabel(iso: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(iso));
  return `Member since ${formatted}`;
}

const menuRows = [
  {
    href: "/profile/edit",
    label: "Edit Profile",
    description: "Photo and display name",
    icon: Pencil,
  },
  {
    href: "/profile/settings",
    label: "Settings",
    description: "Account and security",
    icon: Settings,
  },
] as const;

// The customer Profile screen. Client component because it reads the live
// profile and Beans stores; `recentOrders` (already capped to 3) is passed in
// from the server page so the list is server-rendered and crawlable. Mobile-
// first within the app's max-w-md shell.
export function ProfileScreen({ recentOrders }: { recentOrders: Order[] }) {
  const { profile } = useProfile();
  const { balance } = useBeans();
  const { isAuthenticated, signOut } = useAuth();

  const tier = getTierProgress(balance);

  return (
    <div className="flex flex-col">
      {/* Header — back returns to Home; title matches the other screens'
          spaced uppercase wordmark. Right spacer keeps the title centred. */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href="/home"
          aria-label="Go back"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Profile
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="flex flex-col gap-7 px-5 pb-8 pt-2">
        {/* Identity hero — avatar, display name, member-since. */}
        <section className="flex flex-col items-center text-center naise-rise">
          <ProfileAvatar
            name={profile.displayName}
            avatarUrl={profile.avatarUrl}
            size={88}
            className="text-2xl"
          />
          <h2 className="mt-3 font-heading text-2xl font-bold tracking-tight">
            {profile.displayName}
          </h2>
          <p
            className="mt-0.5 text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {memberSinceLabel(profile.memberSince)}
          </p>
        </section>

        {/* Beans + tier summary — taps through to the Rewards screen. */}
        <Link
          href="/rewards"
          aria-label="View your rewards"
          className="relative flex items-center gap-4 overflow-hidden rounded-[1.5rem] bg-black px-5 py-4 text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 naise-rise [animation-delay:80ms]"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10">
            <Star className="size-5" strokeWidth={2} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="font-heading text-2xl font-bold leading-none tabular-nums">
              {balance.toLocaleString()}
              <span className="ml-1.5 text-sm font-medium text-white/70">
                Beans
              </span>
            </p>
            <p className="mt-1 text-xs text-white/60">
              {tier.current.name} tier
            </p>
          </div>
          <ChevronRight
            className="size-5 shrink-0 text-white/60"
            strokeWidth={2.5}
            aria-hidden
          />
        </Link>

        {/* Account menu rows. */}
        <section
          aria-label="Account"
          className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border naise-rise [animation-delay:140ms]"
        >
          {menuRows.map((row) => {
            const Icon = row.icon;
            return (
              <Link
                key={row.href}
                href={row.href}
                className="flex items-center gap-3.5 px-4 py-3.5 outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-foreground">
                  <Icon className="size-4.5" strokeWidth={2} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold">{row.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {row.description}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={2.5}
                  aria-hidden
                />
              </Link>
            );
          })}
        </section>

        {/* Recent orders — capped at 3, see all opens the full history. */}
        <section
          id="recent-orders"
          aria-labelledby="recent-orders-heading"
          className="scroll-mt-20 naise-rise [animation-delay:200ms]"
        >
          <div className="flex items-center justify-between">
            <h2
              id="recent-orders-heading"
              className="text-xs font-bold uppercase tracking-wide"
            >
              Recent Orders
            </h2>
            {recentOrders.length > 0 && (
              <Link
                href="/profile/orders"
                className="flex items-center gap-0.5 text-[0.6875rem] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
              >
                See all
                <ChevronRight className="size-3.5" strokeWidth={2.5} aria-hidden />
              </Link>
            )}
          </div>

          {recentOrders.length === 0 ? (
            <div className="mt-3 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">No orders yet.</p>
              <Link
                href="/menu"
                className="text-xs font-semibold text-foreground underline-offset-2 hover:underline"
              >
                Browse the menu
              </Link>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-4">
              {recentOrders.map((order, i) => (
                <CustomerOrderCard
                  key={order.token}
                  order={order}
                  delay={i * 60}
                  from="profile"
                />
              ))}
            </ul>
          )}
        </section>

        {/* Sign out for members; sign in for guests. Auth is mocked via the
            localStorage-backed auth store until Supabase Auth lands. */}
        {isAuthenticated ? (
          <button
            type="button"
            onClick={signOut}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border text-xs font-semibold uppercase tracking-[0.15em] text-foreground outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50 naise-rise [animation-delay:260ms]"
          >
            <LogOut className="size-4" strokeWidth={2} aria-hidden />
            Sign Out
          </button>
        ) : (
          <Link
            href="/login?redirect=/profile"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 naise-rise [animation-delay:260ms]"
          >
            <LogIn className="size-4" strokeWidth={2} aria-hidden />
            Sign In
          </Link>
        )}
      </main>
    </div>
  );
}
