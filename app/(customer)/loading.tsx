import { ScreenSkeleton } from "@/components/skeletons/screen-skeleton";

// Group-level fallback for any customer screen without its own loading.tsx
// (cart, rewards, profile, checkout...). More specific loading files (menu,
// product) override this for their segments.
export default function CustomerLoading() {
  return <ScreenSkeleton />;
}
