import { GuardedLink } from "@/components/admin/guarded-link";
import { ChevronLeft } from "lucide-react";

// Back control for CMS sub-pages reached by an in-page link (not from the
// drawer). Padding-free; the parent page controls spacing.
export function AdminBackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <GuardedLink
      href={href}
      className="flex w-fit items-center gap-1 rounded-sm text-sm font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft className="size-4" aria-hidden /> {label}
    </GuardedLink>
  );
}
