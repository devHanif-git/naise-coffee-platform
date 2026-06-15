import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthScreen } from "@/components/auth-screen";

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
