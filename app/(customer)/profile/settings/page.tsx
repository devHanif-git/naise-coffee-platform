import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  ChevronLeft,
  Lock,
  Bell,
  ShieldCheck,
} from "lucide-react";

export const runtime = "edge";

export const metadata: Metadata = {
  title: "Settings",
  description: "Account and security settings for your Naise Coffee profile.",
};

// Dev-only role toggle: flips the `naise_role` cookie that the management gate
// (lib/auth/session.ts) reads, so the staff /manage surface can be exercised
// before Supabase Auth lands. Moved here from the profile screen — it's a
// security/role control, not a profile field. Server action (no client JS).
async function toggleAdminRole() {
  "use server";

  const cookieStore = await cookies();
  const isAdmin = cookieStore.get("naise_role")?.value === "admin";

  if (isAdmin) {
    cookieStore.delete("naise_role");
  } else {
    cookieStore.set("naise_role", "admin", {
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
}

// Security rows are placeholders until Supabase Auth lands.
const securityRows = [
  { label: "Change Password", description: "Update your password", icon: Lock },
  {
    label: "Notifications",
    description: "Manage how we reach you",
    icon: Bell,
  },
  {
    label: "Privacy",
    description: "Control your data",
    icon: ShieldCheck,
  },
] as const;

export default async function ProfileSettingsPage() {
  const cookieStore = await cookies();
  const isAdmin = cookieStore.get("naise_role")?.value === "admin";

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href="/profile"
          aria-label="Back to profile"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Settings
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="flex flex-col gap-7 px-5 pb-8 pt-2">
        {/* Security — placeholder rows until auth lands. */}
        <section
          aria-label="Security"
          className="flex flex-col gap-2 naise-rise"
        >
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Security
          </h2>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {securityRows.map((row) => {
              const Icon = row.icon;
              return (
                <li
                  key={row.label}
                  className="flex items-center gap-3.5 px-4 py-3.5"
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
                  <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    Soon
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Dev role control — flips the staff-access cookie for testing the
            /manage surface. Visible only outside production. */}
        {process.env.NODE_ENV !== "production" && (
          <section
            aria-label="Developer"
            className="flex flex-col gap-2 naise-rise [animation-delay:80ms]"
          >
            <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Developer
            </h2>
            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border px-4 py-4">
              <p className="text-xs text-muted-foreground">
                {isAdmin
                  ? "You currently have staff access — the Manage Orders surface is unlocked."
                  : "Grant staff access to open the Manage Orders surface."}
              </p>
              <form action={toggleAdminRole}>
                <button
                  type="submit"
                  className="flex h-10 w-full items-center justify-center rounded-full bg-black text-[0.6875rem] font-semibold uppercase tracking-wide text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {isAdmin ? "Remove Staff Access" : "Grant Staff Access"}
                </button>
              </form>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
