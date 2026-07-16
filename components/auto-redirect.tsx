"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Fire-and-forget client timer: after `seconds`, navigate to `href`. Used by the
// order-confirmed screen so the customer is eased back to the menu without
// having to tap. Renders nothing.
export function AutoRedirect({ href, seconds }: { href: string; seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setTimeout(() => router.push(href), seconds * 1000);
    return () => clearTimeout(id);
  }, [router, href, seconds]);
  return null;
}
