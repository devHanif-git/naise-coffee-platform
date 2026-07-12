"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Ctx = {
  anyDirty: boolean;
  register: (id: string) => void;
  unregister: (id: string) => void;
  // Returns true if navigation may proceed now; false if intercepted.
  requestNavigation: (href: string) => boolean;
  // Dialog state (read by UnsavedChangesDialog).
  pending: string | null;
  confirm: () => void;
  cancel: () => void;
};

const UnsavedChangesContext = createContext<Ctx | null>(null);

function useCtx(): Ctx {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error("useUnsavedChanges must be used within UnsavedChangesProvider");
  }
  return ctx;
}

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Set of dirty source ids. anyDirty === dirtyIds.size > 0.
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<string | null>(null);

  const anyDirty = dirtyIds.size > 0;

  const register = useCallback((id: string) => {
    setDirtyIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setDirtyIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const requestNavigation = useCallback(
    (href: string) => {
      if (dirtyIds.size === 0) return true;
      setPending(href);
      return false;
    },
    [dirtyIds],
  );

  const confirm = useCallback(() => {
    const href = pending;
    // Clear the whole registry: leaving discards all forms' edits.
    setDirtyIds(new Set());
    setPending(null);
    if (href) router.push(href);
  }, [pending, router]);

  const cancel = useCallback(() => setPending(null), []);

  // Native prompt for tab close / reload / hard back while anything is dirty.
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older engines gate the native prompt on returnValue rather than
      // preventDefault; set both so the prompt fires everywhere.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  const value = useMemo<Ctx>(
    () => ({ anyDirty, register, unregister, requestNavigation, pending, confirm, cancel }),
    [anyDirty, register, unregister, requestNavigation, pending, confirm, cancel],
  );

  return (
    <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>
  );
}

// A form calls this with its own dirty boolean. Registers on dirty, clears on
// clean, and always clears on unmount.
export function useUnsavedChanges(dirty: boolean): void {
  const { register, unregister } = useCtx();
  const id = useId();
  useEffect(() => {
    if (dirty) register(id);
    else unregister(id);
  }, [dirty, id, register, unregister]);
  useEffect(() => () => unregister(id), [id, unregister]);
}

// For imperative navigation inside forms (Cancel buttons, post-action pushes).
export function useGuardedNavigation(): { guardedPush: (href: string) => void } {
  const router = useRouter();
  const { requestNavigation } = useCtx();
  const guardedPush = useCallback(
    (href: string) => {
      if (requestNavigation(href)) router.push(href);
    },
    [requestNavigation, router],
  );
  return { guardedPush };
}

// Read by GuardedLink.
export function useUnsavedChangesGuard(): {
  anyDirty: boolean;
  requestNavigation: (href: string) => boolean;
} {
  const { anyDirty, requestNavigation } = useCtx();
  return { anyDirty, requestNavigation };
}

export function UnsavedChangesDialog() {
  const { pending, confirm, cancel } = useCtx();
  const open = pending !== null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) cancel();
      }}
    >
      <AlertDialogContent className="gap-5 rounded-2xl p-5">
        <AlertDialogHeader className="place-items-center gap-2 text-center sm:place-items-center sm:text-center">
          <AlertDialogMedia className="size-11 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-500">
            <TriangleAlert />
          </AlertDialogMedia>
          <AlertDialogTitle className="font-heading text-base font-semibold">
            Unsaved changes
          </AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ve made changes that haven&apos;t been saved. If you leave now, they&apos;ll be
            lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mx-0 mb-0 grid grid-cols-2 gap-2 border-t-0 bg-transparent p-0 pt-1">
          <AlertDialogCancel onClick={cancel} className="h-11 rounded-full">
            Stay
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={confirm}
            className="h-11 rounded-full"
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
