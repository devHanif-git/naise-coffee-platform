"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CartItem } from "@/types/cart";
import { useAuth } from "@/store/auth";

const DEFAULT_STORAGE_KEY = "naise-cart";
const DEFAULT_NOTES_STORAGE_KEY = "naise-cart-notes";

// Identifies a line by product + size + sorted add-ons. Same drink, different
// settings => different key => separate line. A reward line carries its
// rewardId so it never merges with a paid line (or another reward) of the same
// drink — each redemption is its own free line.
//
// Custom (off-menu) lines have no real product, so the builder passes a
// synthetic `custom:<name>:<sen>` value in the productId slot. That keeps two
// different custom drinks on separate lines while a repeat of the same
// name+price still merges (quantities sum). The synthetic value is a cart-only
// keying device and is never sent to the server (checkout omits it).
export function buildKey(
  productId: string | undefined,
  sizeId: string | undefined,
  addonIds: string[],
  rewardId?: string,
): string {
  return [
    productId ?? "",
    sizeId ?? "",
    [...addonIds].sort().join(","),
    rewardId ?? "",
  ].join("|");
}

type AddInput = Omit<CartItem, "key" | "quantity"> & { quantity?: number };

type CartContextValue = {
  items: CartItem[];
  // True once the persisted cart has loaded from localStorage. Lets consumers
  // distinguish "genuinely empty" from "not loaded yet" and avoid flicker.
  hydrated: boolean;
  // Free-text order notes. Persisted alongside the cart so they survive
  // navigation/reloads and can be carried into the WhatsApp/receipt handoff.
  notes: string;
  setNotes: (notes: string) => void;
  totalItems: number;
  totalPrice: number;
  // Combined pre-discount total; difference from totalPrice is the saving.
  totalOriginal: number;
  totalSaving: number;
  addItem: (input: AddInput) => void;
  // Replaces an existing line's options/quantity. If the new options match
  // another line, the two merge (quantities sum). Returns true when a merge
  // happened so callers can surface a notice.
  updateItem: (oldKey: string, input: AddInput) => boolean;
  incrementItem: (key: string) => void;
  // Drops the quantity by one; removes the line entirely when it hits zero.
  decrementItem: (key: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  // Count of reward lines auto-removed since the last acknowledgement — bumped
  // when the signed-in identity changes (sign-out or an account switch) and the
  // stale free line is dropped. The cart screen reads this to explain why a
  // redeemed drink disappeared, then acknowledges to reset it.
  rewardsRemoved: number;
  acknowledgeRewardsRemoved: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({
  children,
  storageKey = DEFAULT_STORAGE_KEY,
  notesStorageKey = DEFAULT_NOTES_STORAGE_KEY,
}: {
  children: React.ReactNode;
  storageKey?: string;
  notesStorageKey?: string;
}) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // The cart is per-browser; reward lines, however, are a member entitlement.
  // Track who's signed in so a reward line can be dropped when the identity that
  // claimed it goes away.
  const { user, hydrated: authHydrated } = useAuth();
  const authUserId = user?.id ?? null;
  // How many reward lines the strip below has removed, awaiting acknowledgement.
  const [rewardsRemoved, setRewardsRemoved] = useState(0);
  // Live mirror of `items` so the strip effect — keyed on the auth id, not on
  // items — reads the current cart rather than a stale closure. Synced in the
  // effect just above the strip so it's current on every commit.
  const itemsRef = useRef(items);

  // Load persisted cart once on mount. Reading in an effect (rather than a lazy
  // useState initializer) keeps the first client render matching the server's
  // empty cart, avoiding a hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
      if (raw) setItems(JSON.parse(raw) as CartItem[]);
      const storedNotes = localStorage.getItem(notesStorageKey);
      if (storedNotes) setNotes(storedNotes);
    } catch {
      // Ignore malformed/unavailable storage; start with an empty cart.
    }
    setHydrated(true);
  }, [storageKey, notesStorageKey]);

  // Persist on change, but only after the initial load so we never overwrite
  // stored data with the empty starting state.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
      localStorage.setItem(notesStorageKey, notes);
    } catch {
      // Storage may be full or unavailable; cart still works in-memory.
    }
  }, [items, notes, hydrated, storageKey, notesStorageKey]);

  // Reward lines belong to the member who redeemed them. Once both the cart and
  // the auth session have loaded, drop any reward line not stamped with the
  // current user's id — covering sign-out (now a guest, id null), a different
  // member signing in on this browser, and pre-stamp lines from older builds.
  // Paid lines are never touched. Waiting on authHydrated avoids stripping a
  // member's own line during the brief window before their session resolves.
  // Returning the same array when nothing changes prevents a needless re-render.
  // The server still enforces this authoritatively at checkout; this keeps the
  // cart honest in the UI and stops a stale free line from ever being placed.
  // Keep the items mirror current. Runs after every commit and — being defined
  // before the strip effect — updates the ref before the strip reads it.
  useEffect(() => {
    itemsRef.current = items;
  });

  useEffect(() => {
    if (!hydrated || !authHydrated) return;
    const current = itemsRef.current;
    const next = current.filter((i) => !i.isReward || i.redeemedBy === authUserId);
    if (next.length === current.length) return;
    setItems(next);
    setRewardsRemoved((n) => n + (current.length - next.length));
  }, [hydrated, authHydrated, authUserId]);

  const acknowledgeRewardsRemoved = useCallback(() => setRewardsRemoved(0), []);

  const addItem = useCallback((input: AddInput) => {
    const key = buildKey(input.productId, input.sizeId, input.addonIds, input.rewardId);
    const quantity = input.quantity ?? 1;
    setItems((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) =>
          i.key === key ? { ...i, quantity: i.quantity + quantity } : i,
        );
      }
      return [...prev, { ...input, key, quantity }];
    });
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const updateItem = useCallback(
    (oldKey: string, input: AddInput) => {
      const newKey = buildKey(input.productId, input.sizeId, input.addonIds, input.rewardId);
      const quantity = input.quantity ?? 1;
      // A merge happens when the edited options now match a *different* line.
      // Decide this from the current items before queuing the update so the
      // return value is correct synchronously.
      const merged = items.some((i) => i.key === newKey && i.key !== oldKey);
      setItems((prev) => {
        if (merged) {
          // Fold the edited line into the matching one, then drop the original.
          return prev
            .map((i) =>
              i.key === newKey
                ? { ...i, quantity: i.quantity + quantity }
                : i,
            )
            .filter((i) => i.key !== oldKey);
        }
        // No collision: replace the line in place, re-keyed for its new options.
        return prev.map((i) =>
          i.key === oldKey ? { ...input, key: newKey, quantity } : i,
        );
      });
      return merged;
    },
    [items],
  );

  const incrementItem = useCallback((key: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.key === key ? { ...i, quantity: i.quantity + 1 } : i,
      ),
    );
  }, []);

  // Pressing minus reduces the quantity; at one, it removes the line.
  const decrementItem = useCallback((key: string) => {
    setItems((prev) =>
      prev.flatMap((i) => {
        if (i.key !== key) return [i];
        if (i.quantity <= 1) return [];
        return [{ ...i, quantity: i.quantity - 1 }];
      }),
    );
  }, []);

  // Clears items and the order notes together — both are order-scoped.
  const clear = useCallback(() => {
    setItems([]);
    setNotes("");
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
    const totalPrice = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const totalOriginal = items.reduce(
      // Fall back to unitPrice for carts persisted before discounts shipped.
      (sum, i) => sum + (i.unitOriginalPrice ?? i.unitPrice) * i.quantity,
      0,
    );
    return {
      items,
      hydrated,
      notes,
      setNotes,
      totalItems,
      totalPrice,
      totalOriginal,
      totalSaving: totalOriginal - totalPrice,
      addItem,
      updateItem,
      incrementItem,
      decrementItem,
      removeItem,
      clear,
      rewardsRemoved,
      acknowledgeRewardsRemoved,
    };
  }, [items, hydrated, notes, addItem, updateItem, incrementItem, decrementItem, removeItem, clear, rewardsRemoved, acknowledgeRewardsRemoved]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
