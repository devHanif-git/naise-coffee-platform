"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Mounted inside the "Waiting for payment" screen. The order page reconciles
// against CHIP on every server render (retrieve → markOrderPaid → settle), so we
// just re-run that render on an interval: once CHIP reports paid, the order flips
// to pending, the page renders the tracker instead, and this poller unmounts.
// Stops after `maxMs` so an abandoned/failed payment doesn't poll forever — the
// customer can still tap "Complete payment" to resume.
export function PaymentWaitingPoller({
  intervalMs = 3000,
  maxMs = 120000,
}: {
  intervalMs?: number;
  maxMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started >= maxMs) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, maxMs]);
  return null;
}
