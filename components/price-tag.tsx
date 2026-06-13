import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductPricing } from "@/types/menu";

// Renders a price, switching to a "sale" treatment when a discount applies:
// struck original, rose final price, percent-off pill, and (on detail) a
// saving line. `card` is the compact menu-card pill; `detail` is the larger
// product-page header.
export function PriceTag({
  pricing,
  variant = "card",
  className,
}: {
  pricing: ProductPricing;
  variant?: "card" | "detail";
  className?: string;
}) {
  const { original, final, saving, percentOff, discount } = pricing;
  const discounted = percentOff > 0;

  if (variant === "detail") {
    if (!discounted) {
      return (
        <p className={cn("text-lg font-bold", className)}>
          {formatPrice(final)}
        </p>
      );
    }
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-2xl font-bold text-rose-600">
            {formatPrice(final)}
          </span>
          <span className="text-base font-medium text-muted-foreground line-through">
            {formatPrice(original)}
          </span>
          <span className="inline-flex items-center rounded-full bg-rose-600 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
            {percentOff}% Off
          </span>
        </div>
        <p className="text-sm font-semibold text-rose-600">
          You save {formatPrice(saving)}
          {discount ? ` · ${discount.label}` : ""}
        </p>
      </div>
    );
  }

  if (!discounted) {
    return (
      <span
        className={cn(
          "inline-flex w-fit rounded-full bg-black px-3 py-1 text-sm font-bold text-white",
          className,
        )}
      >
        {formatPrice(final)}
      </span>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="inline-flex items-center rounded-full bg-rose-600 px-3 py-1 text-sm font-bold text-white">
        {formatPrice(final)}
      </span>
      <span className="text-sm font-medium text-muted-foreground line-through">
        {formatPrice(original)}
      </span>
    </div>
  );
}
