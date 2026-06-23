import { ScreenSkeleton } from "@/components/skeletons/screen-skeleton";

// Instant fallback rendered inside the admin shell while a dashboard or sub-page
// streams. Also covers navigation between admin sub-pages, which inherit this
// boundary when they don't define their own.
export default function AdminLoading() {
  return <ScreenSkeleton />;
}
