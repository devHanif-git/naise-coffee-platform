"use client";

import { useState } from "react";
import { GuardedLink } from "@/components/admin/guarded-link";
import { usePathname } from "next/navigation";
import {
  Menu,
  LayoutDashboard,
  ClipboardList,
  Coffee,
  Tag,
  Star,
  Users,
  BarChart3,
  Settings,
  Store,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/manage", label: "Orders", icon: ClipboardList },
  { href: "/admin/menu", label: "Menu", icon: Coffee },
  { href: "/admin/promotions", label: "Promotions", icon: Tag },
  { href: "/admin/rewards", label: "Rewards", icon: Star },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  // "/admin" is a prefix of every CMS route, so it must match exactly; other
  // items also light up on their sub-routes.
  return href === "/admin"
    ? pathname === "/admin"
    : pathname === href || pathname.startsWith(`${href}/`);
}

function Wordmark() {
  return (
    <span className="font-heading text-sm font-bold uppercase tracking-[0.2em]">
      Naise Admin
    </span>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <GuardedLink
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                : "font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            {item.label}
          </GuardedLink>
        );
      })}
    </nav>
  );
}

// Always-present escape hatch out of the CMS back into the customer app.
// Pinned below the nav in both the sidebar and the mobile sheet so staff can
// jump to their profile (where the staff tools live) from any admin page.
function ExitToApp({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <GuardedLink
      href="/profile"
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Store className="size-5 shrink-0" aria-hidden />
      Back to app
    </GuardedLink>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Wordmark />
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <div className="border-t border-sidebar-border p-3">
          <ExitToApp />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-sidebar px-4 text-sidebar-foreground lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label="Open menu"
            className="flex size-9 items-center justify-center rounded-lg outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent
            side="left"
            className="flex w-72 flex-col bg-sidebar p-0 text-sidebar-foreground"
          >
            <SheetTitle className="flex h-14 items-center border-b border-sidebar-border px-5">
              <Wordmark />
            </SheetTitle>
            <div className="flex-1 overflow-y-auto">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-sidebar-border p-3">
              <ExitToApp onNavigate={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <Wordmark />
      </header>

      <div className="lg:pl-60">
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
