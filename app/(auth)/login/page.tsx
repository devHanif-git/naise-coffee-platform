import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthScreen } from "@/components/auth-screen";

// Server actions / session writes happen client-side in the mock, but keep edge
// runtime consistent with the rest of the deployed routes (Cloudflare Pages).
export const runtime = "edge";

export const metadata: Metadata = {
  title: "Sign In",
  description:
    "Sign in or create your Naise Coffee account to earn Beans, redeem free drinks, and build a daily streak.",
};

export default function LoginPage() {
  return (
    <Suspense>
      <AuthScreen />
    </Suspense>
  );
}
