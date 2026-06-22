import { Skeleton } from "@/components/ui/skeleton";

// Instant fallback while a product page loads. Opening a product is the most
// common tap from the menu, so a tailored shell keeps it from feeling frozen.
export default function ProductLoading() {
  return (
    <div className="flex flex-col">
      <div className="relative aspect-square w-full bg-black" />
      <div className="flex flex-col gap-4 px-5 pt-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="mt-1 h-5 w-20" />
        </div>
        <hr className="border-border" />
        <div className="flex flex-col gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <div className="flex gap-2">
                <Skeleton className="h-10 w-20 rounded-xl" />
                <Skeleton className="h-10 w-20 rounded-xl" />
                <Skeleton className="h-10 w-20 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
