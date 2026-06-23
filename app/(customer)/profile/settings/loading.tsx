import { ScreenSkeleton } from "@/components/skeletons/screen-skeleton";

// Instant fallback shown the moment the Settings row is tapped, while the
// server streams the screen — so the navigation isn't a dead freeze.
export default function ProfileSettingsLoading() {
  return <ScreenSkeleton />;
}
