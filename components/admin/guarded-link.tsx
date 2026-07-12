"use client";

import Link from "next/link";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes";

// Drop-in next/link wrapper. When any admin form is dirty, cancels client-side
// navigation and lets the provider open the confirm dialog (which performs the
// push itself on "Leave").
export function GuardedLink({ children, ...props }: React.ComponentProps<typeof Link>) {
  const { requestNavigation } = useUnsavedChangesGuard();
  return (
    <Link
      {...props}
      onNavigate={(e) => {
        const href =
          typeof props.href === "string" ? props.href : (props.href.pathname ?? "");
        if (!requestNavigation(href)) {
          e.preventDefault();
        }
        props.onNavigate?.(e);
      }}
    >
      {children}
    </Link>
  );
}
