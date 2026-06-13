"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";

// Back control for the product page. When the page was opened from the cart to
// edit a line (?edit=<key>), back returns to the cart; otherwise to the menu.
// Reading the param client-side keeps the page itself statically prerendered.
export function ProductBackButton() {
  const editing = useSearchParams().has("edit");
  return (
    <Link
      href={editing ? "/cart" : "/menu"}
      aria-label="Go back"
      className="absolute left-5 top-4 z-10 flex size-8 items-center justify-center rounded-full text-white outline-none focus-visible:ring-3 focus-visible:ring-white/40"
    >
      <ChevronLeft className="size-6" />
    </Link>
  );
}
