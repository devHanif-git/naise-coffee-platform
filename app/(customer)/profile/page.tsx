import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
};

export default function ProfilePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h1 className="font-heading text-2xl font-semibold">Profile</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming soon.</p>
    </main>
  );
}
