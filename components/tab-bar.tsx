"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Home, ShoppingCart, Star, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCart } from "@/store/cart";

const tabs = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/menu", label: "Menu", icon: BookOpen },
  { href: "/cart", label: "Cart", icon: ShoppingCart },
  { href: "/rewards", label: "Rewards", icon: Star },
  { href: "/profile", label: "Profile", icon: User },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const { totalItems: cartCount } = useCart();

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex h-16 items-stretch justify-around px-2">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          const badgeCount = tab.href === "/cart" ? cartCount : 0;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors",
                  active
                    ? "text-black"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <Icon
                    className="size-6"
                    strokeWidth={active ? 2.5 : 2}
                    aria-hidden
                  />
                  {badgeCount > 0 && (
                    <span
                      aria-label={`${badgeCount} items in cart`}
                      className="absolute -right-2.5 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1.5 text-[0.6875rem] font-semibold leading-none text-white"
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
