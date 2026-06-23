"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import {
  ChevronRight,
  ClipboardList,
  Coffee,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  type LucideIcon,
  Pencil,
  Settings,
  Star,
  User,
} from "lucide-react";
import type { Order } from "@/types/order";
import type { RewardTier } from "@/types/reward";
import { MANAGE_ROLES, type Role } from "@/types/auth";
import { getTierProgress } from "@/lib/rewards/tiers";
import { useAuth } from "@/store/auth";
import { useBeans } from "@/store/beans";
import { useProfile } from "@/store/profile";
import { ProfileAvatar } from "@/components/profile-avatar";
import { CustomerOrderCard } from "@/components/customer-order-card";
import { SignOutConfirmModal } from "@/components/signout-confirm-modal";

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

// Trailing chevron for a navigation row that swaps to a spinner while the row's
// Link is mid-navigation. useLinkStatus reads the enclosing Link's pending state
// (App Router), so the tapped row gives feedback instantly — even when the
// destination's layout runs a server-side auth check before its page can paint
// (Manage, Admin Dashboard). Used outside a Link (the inert Custom Order row) it
// harmlessly stays a static chevron.
function RowChevron() {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2
      className="size-4 shrink-0 animate-spin text-muted-foreground"
      strokeWidth={2.5}
      aria-hidden
    />
  ) : (
    <ChevronRight
      className="size-4 shrink-0 text-muted-foreground"
      strokeWidth={2.5}
      aria-hidden
    />
  );
}

// A single row inside the staff tools card. Renders a Link when `href` is set,
// otherwise an inert button (used by the not-yet-built Custom Order entry).
// Styling matches the account menu rows so the two cards read as one family.
function StaffRow({
  icon: Icon,
  label,
  description,
  href,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  href?: string;
}) {
  const className =
    "flex items-center gap-3.5 px-4 py-3.5 text-left outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50";
  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-foreground">
        <Icon className="size-4.5" strokeWidth={2} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold">{label}</span>
        <span className="truncate text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <RowChevron />
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  // Custom Order is a placeholder for now — a button with no action.
  return (
    <button type="button" className={`w-full ${className}`}>
      {content}
    </button>
  );
}

// The customer Profile screen. Client component because it reads the live
// profile and Beans stores; `recentOrders` (already capped to 3) is passed in
// from the server page so the list is server-rendered and crawlable. Mobile-
// first within the app's max-w-md shell.
//
// Guests (signed-out browsers) see a stripped-down variant: silhouette
// avatar, "Guest" label, no Beans/tier card, no Edit Profile / Settings rows.
// Their recent orders are still shown — scoped server-side to the per-browser
// owner id, which carries over to the account they later register.
export function ProfileScreen({
  recentOrders,
  tiers,
  role,
}: {
  recentOrders: Order[];
  tiers: RewardTier[];
  role: Role | null;
}) {
  // Staff tooling is gated on the server-fetched role (authoritative, no
  // hydration drift), so it renders consistently on first paint. Manage is for
  // anyone who can work the order board; the dashboard is manager/admin only;
  // Custom Order is admin only.
  const canManage = role !== null && MANAGE_ROLES.includes(role);
  const canViewDashboard = role === "admin" || role === "manager";
  const isAdminRole = role === "admin";

  const { profile, hydrated: profileHydrated } = useProfile();
  const { balance, lifetimeEarned } = useBeans();
  const { isAuthenticated, hydrated: authHydrated, signOut } = useAuth();
  const [signOutOpen, setSignOutOpen] = useState(false);

  const tier = getTierProgress(lifetimeEarned, tiers);

  // Identity shown in the hero comes straight from the profile store, which is
  // now backed by the `profiles` row (display_name / avatar_url / created_at)
  // and falls back to the session identity internally if the row is missing.
  // So an edited display name/photo always wins, and there's no mock left.
  const displayName = profile.displayName;
  const avatarUrl = profile.avatarUrl;
  const memberSince = profile.memberSince;

  // Both stores must settle before we know what to show. Until then we render a
  // neutral skeleton hero rather than guessing — otherwise the screen flashes
  // through three states on load (guest → fallback name → real profile) as auth
  // resolves and then the profile row fetches. Gating on both flags collapses
  // that into a single reveal.
  const ready = authHydrated && profileHydrated;

  return (
    <div className="flex flex-col">
      {/* Header — back returns to Home; title matches the other screens'
          spaced uppercase wordmark. Right spacer keeps the title centred. */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <div className="size-9" aria-hidden />
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Profile
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="flex flex-col gap-7 px-5 pb-8 pt-2">
        {/* Identity hero. Members see avatar + display name + member-since;
            guests see a silhouette + "Guest" + a sign-in nudge. Until both the
            auth and profile stores settle we show a neutral skeleton so the
            screen reveals the resolved identity once, with no flash-through. */}
        {!ready ? (
          <section className="flex flex-col items-center text-center">
            <span
              aria-hidden
              className="size-22 animate-pulse rounded-full bg-neutral-100"
              style={{ width: 88, height: 88 }}
            />
            <span
              aria-hidden
              className="mt-3 h-7 w-40 animate-pulse rounded-md bg-neutral-100"
            />
            <span
              aria-hidden
              className="mt-2 h-3.5 w-28 animate-pulse rounded bg-neutral-100"
            />
            <span className="sr-only">Loading profile…</span>
          </section>
        ) : isAuthenticated ? (
          <section className="flex flex-col items-center text-center naise-rise">
            <ProfileAvatar
              name={displayName}
              avatarUrl={avatarUrl}
              size={88}
              className="text-2xl"
            />
            <h2 className="mt-3 font-heading text-2xl font-bold tracking-tight">
              {displayName}
            </h2>
            <p
              className="mt-0.5 text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              {memberSinceLabel(memberSince)}
            </p>
          </section>
        ) : (
          <section className="flex flex-col items-center text-center naise-rise">
            <span
              aria-hidden
              className="flex size-22 items-center justify-center rounded-full bg-neutral-100 text-neutral-400"
              style={{ width: 88, height: 88 }}
            >
              <User className="size-10" strokeWidth={1.75} />
            </span>
            <h2 className="mt-3 font-heading text-2xl font-bold tracking-tight">
              Guest
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Sign in to save your beans &amp; order history
            </p>
          </section>
        )}

        {/* Beans + tier summary — members only. Hidden for guests since
            they can't earn or redeem until they have an account. Gated on
            `ready` so it doesn't pop in during the skeleton stage. */}
        {ready && isAuthenticated && (
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
        )}

        {/* Staff tools — only for accounts with a manage-capable role. Sits
            above the account rows so it's the first thing staff reach. Not
            gated on the client `ready` flag because `role` is a server prop. */}
        {canManage && (
          <section
            aria-label="Staff"
            className="flex flex-col gap-3 naise-rise [animation-delay:110ms]"
          >
            <h2 className="text-xs font-bold uppercase tracking-wide">Staff</h2>
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border">
              <StaffRow
                icon={ClipboardList}
                label="Manage"
                description="Live order board"
                href="/manage?from=profile"
              />
              {canViewDashboard && (
                <StaffRow
                  icon={LayoutDashboard}
                  label="Admin Dashboard"
                  description="Reports and store performance"
                  href="/admin"
                />
              )}
              {isAdminRole && (
                <StaffRow
                  icon={Coffee}
                  label="Custom Order"
                  description="Build a one-off order"
                  href="/custom-order"
                />
              )}
            </div>
          </section>
        )}

        {/* Account menu rows — members only. Edit Profile / Settings need an
            account to act on; guests don't see them. Gated on `ready` so the
            rows don't flash in before identity resolves. */}
        {ready && isAuthenticated && (
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
                  <RowChevron />
                </Link>
              );
            })}
          </section>
        )}

        {/* Recent orders — capped at 3 for both members and guests. The
            heading copy changes for guests so it's clear the orders are
            tied to this device, not (yet) to an account. */}
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
              {isAuthenticated ? "Recent Orders" : "Your orders on this device"}
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

        {/* Sign out for members; sign in for guests. Per spec, the two
            buttons just swap on toggle — no entry animation, no transition
            between them — so dropping the `naise-rise` class here is
            intentional. Auth is mocked via the localStorage-backed auth
            store until Supabase Auth lands. Gated on `ready` so the button
            doesn't flip from Sign In to Sign Out as identity resolves. */}
        {!ready ? (
          <span
            aria-hidden
            className="h-12 w-full animate-pulse rounded-full bg-neutral-100"
          />
        ) : isAuthenticated ? (
          <button
            type="button"
            onClick={() => setSignOutOpen(true)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border text-xs font-semibold uppercase tracking-[0.15em] text-foreground outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <LogOut className="size-4" strokeWidth={2} aria-hidden />
            Sign Out
          </button>
        ) : (
          <Link
            href="/login?redirect=/profile"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <LogIn className="size-4" strokeWidth={2} aria-hidden />
            Sign In
          </Link>
        )}
      </main>

      {signOutOpen && (
        <SignOutConfirmModal
          onConfirm={() => {
            setSignOutOpen(false);
            signOut();
          }}
          onClose={() => setSignOutOpen(false)}
        />
      )}
    </div>
  );
}
