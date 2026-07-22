import { useEffect } from "react";

// Shared, reference-counted body scroll lock. Several modals can be open at
// once (e.g. Install + Welcome both fire right after login). A naive per-modal
// save/restore corrupts this: the second modal captures the already-"hidden"
// value and restores IT on close, leaving the body permanently locked. Counting
// locks and only restoring when the last one releases composes safely.
let locks = 0;
let restore = "";

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      restore = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = restore;
    };
  }, [active]);
}
