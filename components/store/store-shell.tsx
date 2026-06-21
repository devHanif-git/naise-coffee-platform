"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCart } from "@/store/cart";
import { STORE_IDLE_TIMEOUT_MS } from "@/constants/store";

// Clears an abandoned cart and returns to the menu after inactivity, so one
// customer's half-order never greets the next. Disabled on the login screen.
export function StoreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { clear, items } = useCart();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLogin = pathname === "/store/login";

  useEffect(() => {
    if (onLogin) return;
    function reset() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (items.length > 0 || pathname !== "/store") {
          clear();
          router.push("/store");
        }
      }, STORE_IDLE_TIMEOUT_MS);
    }
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [onLogin, pathname, items, clear, router]);

  return <>{children}</>;
}
