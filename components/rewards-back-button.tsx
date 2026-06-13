import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// Back control for the Rewards page. Rewards is reachable from the home banner
// and from the bottom tab bar; in both cases its logical parent is Home, so
// back always returns there. An explicit href (rather than router.back()) makes
// the destination deterministic regardless of browser history or deep links.
export function RewardsBackButton() {
  return (
    <Link
      href="/home"
      aria-label="Go back"
      className="flex size-8 items-center justify-center rounded-full text-white outline-none focus-visible:ring-3 focus-visible:ring-white/40"
    >
      <ChevronLeft className="size-6" />
    </Link>
  );
}
