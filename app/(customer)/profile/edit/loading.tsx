import { ScreenSkeleton } from "@/components/skeletons/screen-skeleton";

// Instant fallback shown the moment the Edit Profile row is tapped, while the
// server streams the screen — so the navigation isn't a dead freeze.
export default function ProfileEditLoading() {
  return <ScreenSkeleton />;
}
