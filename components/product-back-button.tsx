"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";

// Back control for the product page. Destination depends on how the page was
// opened: redeeming a reward (?reward=<id>) returns to Rewards; otherwise to the
// menu. Editing a cart line (?edit=<key>) also returns to the menu, where the
// floating cart sheet lives (it stays open across the edit). Reading the param
// client-side keeps the page itself statically prerendered.
export function ProductBackButton() {
  const params = useSearchParams();
  const href = params.has("reward") ? "/rewards" : "/menu";
  return (
    <Link
      href={href}
      aria-label="Go back"
      className="absolute left-5 top-4 z-10 flex size-9 items-center justify-center rounded-full text-white outline-none focus-visible:ring-3 focus-visible:ring-white/40"
    >
      <ChevronLeft className="size-6" />
    </Link>
  );
}
