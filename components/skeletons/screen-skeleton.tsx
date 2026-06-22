import { Skeleton } from "@/components/ui/skeleton";

// Neutral loading shell for screens without a bespoke skeleton (cart, checkout,
// rewards, profile...). Shared by the customer group fallback and the kiosk
// cart/checkout so loading states look the same everywhere.
export function ScreenSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
