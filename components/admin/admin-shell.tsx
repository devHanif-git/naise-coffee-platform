"use client";

import { useState } from "react";
import Link from "next/link";
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

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-black px-4 text-white">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label="Open menu"
            className="flex size-9 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-white/40"
          >
            <Menu className="size-6" />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="border-b border-border px-5 py-4 font-heading text-base font-bold uppercase tracking-[0.2em]">
              Naise Admin
            </SheetTitle>
            <nav className="flex flex-col py-2">
              {NAV.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-neutral-100 text-black"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </SheetContent>
        </Sheet>
        <span className="font-heading text-sm font-bold uppercase tracking-[0.2em]">
          Naise Admin
        </span>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
