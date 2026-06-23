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

// Temporarily hidden from the tab bar. Home is hidden for now (root lands on
// /menu), and Cart moved to a floating button (CartFab). Remove entries here to
// restore them.
const hiddenTabs: ReadonlySet<string> = new Set(["/home", "/cart"]);

export function TabBar({ showRewards = true }: { showRewards?: boolean }) {
  const pathname = usePathname();
  const { totalItems: cartCount } = useCart();

  // Product detail pages (/menu/<slug>) host their own full-width action bar at
  // the bottom edge. Step the tab bar aside there so that bar can sit flush at
  // the bottom of the screen instead of floating above the tabs.
  const isProductDetail =
    pathname.startsWith("/menu/") && pathname !== "/menu";
  if (isProductDetail) return null;

  // Tapping the tab you're already on (exact route, not a sub-page) scrolls the
  // screen back to the top instead of being a no-op navigation — the standard
  // mobile tab-bar gesture. Sub-routes (e.g. /menu/<slug>) still navigate up to
  // the list.
  const handleTabClick = (e: React.MouseEvent, href: string) => {
    if (pathname === href) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-1/2 z-[55] w-full max-w-md -translate-x-1/2 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex h-16 items-stretch justify-around px-2">
        {tabs
          .filter((tab) => !hiddenTabs.has(tab.href))
          .filter((tab) => showRewards || tab.href !== "/rewards")
          .map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          const badgeCount = tab.href === "/cart" ? cartCount : 0;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                onClick={(e) => handleTabClick(e, tab.href)}
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
