import { cn } from "@/lib/utils";

// Pulsing placeholder block. Use inside loading.tsx route fallbacks and Suspense
// boundaries so navigations show an instant shape while server data streams in.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-neutral-200/80", className)}
      {...props}
    />
  );
}

export { Skeleton };
