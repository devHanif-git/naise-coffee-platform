"use client";

import { useEffect, useState } from "react";

// True only after the component has mounted on the client. Use to skip
// rendering DOM-measuring children (e.g. recharts ResponsiveContainer) during
// SSR, where there's no layout to measure.
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
