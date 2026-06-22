"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Tracks which section is under the sticky header and scrolls to a section on
// demand. A thin trigger band sits just below the sticky header (top inset =
// `offset`); the topmost section in `ids` order that is inside the band is the
// active one. Before any section reaches the band (e.g. while the best-seller
// strip is on screen), the first id stays active — no dead state.
export function useScrollSpy(ids: string[], offset: number) {
  const [activeId, setActiveId] = useState<string>(ids[0] ?? "");
  const visible = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (ids.length === 0) return;
    visible.current = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.current.add(entry.target.id);
          else visible.current.delete(entry.target.id);
        }
        const topmost = ids.find((id) => visible.current.has(id));
        if (topmost) setActiveId(topmost);
      },
      // Band: from `offset` px below the viewport top down to the top 25% of the
      // viewport (large negative bottom inset), so usually one heading qualifies.
      { rootMargin: `-${offset}px 0px -75% 0px`, threshold: 0 },
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids, offset]);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    setActiveId(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return { activeId, scrollTo };
}
