import { Skeleton } from "@/components/ui/skeleton";

// Loading shell for the menu list (MenuBrowser), shared by the customer
// storefront (/menu) and the kiosk (/store) so both feel identical. Mirrors the
// black header + search + category tabs + card list layout.
export function MenuSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="bg-black">
        <div className="px-5 pb-4 pt-3">
          <div className="flex items-center justify-between">
            <div className="size-9" aria-hidden />
            <Skeleton className="h-4 w-16 bg-white/15" />
            <div className="size-9" aria-hidden />
          </div>
          <Skeleton className="mt-3 h-11 w-full rounded-2xl bg-white/10" />
        </div>
        <div className="flex gap-2 bg-white px-5 pt-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-7 w-28 rounded-lg" />
        </div>
        <div className="flex flex-col divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-4">
              <Skeleton className="h-24 w-20 rounded-2xl" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="size-8 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
