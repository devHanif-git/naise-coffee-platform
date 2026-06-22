import { MenuSkeleton } from "@/components/skeletons/menu-skeleton";

// Instant fallback shown the moment the Menu tab/link is tapped, while the
// server renders the live catalog.
export default function MenuLoading() {
  return <MenuSkeleton />;
}
