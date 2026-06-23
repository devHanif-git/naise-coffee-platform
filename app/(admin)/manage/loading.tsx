import { ScreenSkeleton } from "@/components/skeletons/screen-skeleton";

// Instant fallback for the order board. The page awaits an auth check and two
// order queries before it can paint, so without this the Manage button looks
// dead on slow connections — this skeleton stands in while that runs.
export default function ManageLoading() {
  return <ScreenSkeleton />;
}
