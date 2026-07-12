"use client";

import Link from "next/link";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes";

// Flatten next/link's string | UrlObject href into the path string the provider
// re-pushes on "Leave". App Router's router.push wants a string, so preserve
// pathname + search + hash rather than dropping to a bare pathname.
function hrefToString(href: React.ComponentProps<typeof Link>["href"]): string {
  if (typeof href === "string") return href;
  // search/hash can be null (not just undefined), so coalesce explicitly.
  return `${href.pathname ?? ""}${href.search ?? ""}${href.hash ?? ""}`;
}

// Drop-in next/link wrapper. When any admin form is dirty, cancels client-side
// navigation and lets the provider open the confirm dialog (which performs the
// push itself on "Leave").
export function GuardedLink({ children, ...props }: React.ComponentProps<typeof Link>) {
  const { requestNavigation } = useUnsavedChangesGuard();
  return (
    <Link
      {...props}
      onNavigate={(e) => {
        if (!requestNavigation(hrefToString(props.href))) {
          e.preventDefault();
        }
        props.onNavigate?.(e);
      }}
    >
      {children}
    </Link>
  );
}
