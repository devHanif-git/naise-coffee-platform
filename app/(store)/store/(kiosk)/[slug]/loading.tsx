import { Skeleton } from "@/components/ui/skeleton";

// Matches the kiosk product page: back button, centered drink image, title,
// description, then the customizer options.
export default function StoreProductLoading() {
  return (
    <div className="flex flex-col p-5">
      <Skeleton className="mb-2 size-10 rounded-full" />
      <Skeleton className="mx-auto mb-4 h-56 w-44 rounded-3xl" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="mt-2 h-3 w-3/4" />
      <div className="mt-5 flex flex-col gap-5">
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
  );
}
