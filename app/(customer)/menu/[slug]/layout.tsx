import { requireUser } from "@/lib/auth/session";

// Tapping a drink opens its detail/customize page — members only. The menu
// listing (/menu) stays public; this gate covers /menu/<slug> and below.
export default async function ProductGateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return <>{children}</>;
}
