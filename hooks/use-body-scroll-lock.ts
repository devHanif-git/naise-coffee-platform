import { useEffect } from "react";

// Shared, reference-counted body scroll lock. Several modals can be open at
// once (e.g. Install + Welcome both fire right after login). Counting locks and
// only releasing when the last one closes composes safely. Uses position:fixed
// rather than overflow:hidden because mobile Safari ignores the latter and keeps
// rubber-banding the page behind the overlay.
let locks = 0;
let savedScrollY = 0;

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      savedScrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.width = "100%";
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [active]);
}
