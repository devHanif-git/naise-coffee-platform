import { cn } from "@/lib/utils";

// Storefront notice shown when the store is closed (store_settings.is_open=false).
// Margin-free by default; callers control spacing via `className` so the banner
// can sit below a screen's header and align with the content width.
export function StoreClosedBanner({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900",
        className,
      )}
    >
      {message}
    </div>
  );
}
