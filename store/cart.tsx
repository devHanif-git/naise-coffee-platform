"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CartItem } from "@/types/cart";

const STORAGE_KEY = "naise-cart";
const NOTES_STORAGE_KEY = "naise-cart-notes";

// Identifies a line by product + size + sorted add-ons. Same drink, different
// settings => different key => separate line.
export function buildKey(
  productId: string,
  sizeId: string | undefined,
  addonIds: string[],
): string {
  return [productId, sizeId ?? "", [...addonIds].sort().join(",")].join("|");
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
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Load persisted cart once on mount. Reading in an effect (rather than a lazy
  // useState initializer) keeps the first client render matching the server's
  // empty cart, avoiding a hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
      if (raw) setItems(JSON.parse(raw) as CartItem[]);
      const storedNotes = localStorage.getItem(NOTES_STORAGE_KEY);
      if (storedNotes) setNotes(storedNotes);
    } catch {
      // Ignore malformed/unavailable storage; start with an empty cart.
    }
    setHydrated(true);
  }, []);

  // Persist on change, but only after the initial load so we never overwrite
  // stored data with the empty starting state.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      localStorage.setItem(NOTES_STORAGE_KEY, notes);
    } catch {
      // Storage may be full or unavailable; cart still works in-memory.
    }
  }, [items, notes, hydrated]);

  const addItem = useCallback((input: AddInput) => {
    const key = buildKey(input.productId, input.sizeId, input.addonIds);
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
      const newKey = buildKey(input.productId, input.sizeId, input.addonIds);
      const quantity = input.quantity ?? 1;
      // A merge happens when the edited options now match a *different* line.
      const merged = items.some(
        (i) => i.key === newKey && i.key !== oldKey,
      );
      setItems((prev) => {
        const collision = prev.find(
          (i) => i.key === newKey && i.key !== oldKey,
        );
        if (collision) {
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
    };
  }, [items, hydrated, notes, addItem, updateItem, incrementItem, decrementItem, removeItem, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
