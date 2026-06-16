"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AuthMethod, AuthUser } from "@/types/auth";
import { getOrCreateOwnerId, setOwnerId } from "@/lib/auth/owner-id";

const AUTH_KEY = "naise-auth";
// Set the moment a guest becomes a member; consumed once to show the welcome
// modal, then cleared. Kept separate from the user record so signing out and
// back in (an existing member) never re-triggers the new-user celebration.
const WELCOME_KEY = "naise-auth-welcome";
// Tracks identities (email/phone) that have signed in on this browser before.
// Lets us suppress the welcome modal when a returning member signs back in
// without needing a real backend lookup. JSON-encoded array of strings.
const KNOWN_IDENTITIES_KEY = "naise-auth-known";

type SignInInput = {
  method: AuthMethod;
  email?: string;
  phone?: string;
  name?: string;
};

type AuthContextValue = {
  // True once the persisted session has loaded from localStorage. Lets the UI
  // avoid flashing the guest state before we know whether someone is signed in.
  hydrated: boolean;
  user: AuthUser | null;
  isAuthenticated: boolean;
  // Whether a freshly-registered user is owed the one-time welcome modal.
  showWelcome: boolean;
  // Mock sign-in/registration. Creates a session and, for a brand-new identity,
  // arms the welcome modal. Wire to Supabase Auth (OAuth / phone OTP) later.
  signIn: (input: SignInInput) => void;
  signOut: () => void;
  // Dismisses the one-time welcome modal (clears the flag so it never re-shows).
  dismissWelcome: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// A friendly default name when sign-in didn't carry one (e.g. phone OTP before
// the profile is filled in). Google sign-in supplies the account name.
function defaultName(input: SignInInput): string {
  if (input.name?.trim()) return input.name.trim();
  if (input.method === "phone" && input.phone) return input.phone;
  return "Naise Member";
}

// Stable per-identity key used to recognize a returning member. Phone
// numbers are normalised by stripping spaces; email is lowercased. The key
// includes the method so a Google account and a phone number that happen to
// share a string don't collide.
function identityKey(input: SignInInput): string | null {
  if (input.method === "google" && input.email) {
    return `google:${input.email.trim().toLowerCase()}`;
  }
  if (input.method === "phone" && input.phone) {
    return `phone:${input.phone.replace(/\s+/g, "")}`;
  }
  return null;
}

function readKnownIdentities(): Set<string> {
  try {
    const raw = localStorage.getItem(KNOWN_IDENTITIES_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function writeKnownIdentities(known: Set<string>): void {
  try {
    localStorage.setItem(
      KNOWN_IDENTITIES_KEY,
      JSON.stringify([...known]),
    );
  } catch {
    // Non-fatal; worst case we re-show the welcome modal next time.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Start signed-out so the first client render matches the server HTML; the
  // persisted session loads in the effect below (same approach as the cart,
  // profile, and Beans stores — avoids a hydration mismatch).
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
      if (raw) setUser(JSON.parse(raw) as AuthUser);
      if (localStorage.getItem(WELCOME_KEY) === "1") setShowWelcome(true);
    } catch {
      // Ignore malformed/unavailable storage; start as a guest.
    }
    // Make sure every visitor has an owner id from first paint, so guest
    // orders attribute correctly even before they ever sign in.
    getOrCreateOwnerId();
    setHydrated(true);
  }, []);

  // Persist the session after the initial load so we never clobber a stored
  // session with the signed-out starting state.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (user) localStorage.setItem(AUTH_KEY, JSON.stringify(user));
      else localStorage.removeItem(AUTH_KEY);
    } catch {
      // Storage may be full/unavailable; session still works in-memory.
    }
  }, [user, hydrated]);

  const signIn = useCallback((input: SignInInput) => {
    // Adopt the existing per-browser owner id as the user's id. This is the
    // mechanism that carries guest orders into the new account: every order
    // placed before sign-in already has this same ownerId, so the profile's
    // `listOrdersFor(ownerId)` query keeps showing them. (In Supabase later,
    // the user's auth.uid() takes over and we run a one-shot UPDATE keyed on
    // this id to migrate the rows.)
    const ownerId = getOrCreateOwnerId();

    // Returning identity? Skip the welcome modal. New identity? Arm it and
    // remember the identity for next time. A sign-in that doesn't carry an
    // identity key (shouldn't happen with Google/phone, but defensive) is
    // treated as new.
    const key = identityKey(input);
    const known = readKnownIdentities();
    const isReturning = key !== null && known.has(key);

    const next: AuthUser = {
      id: ownerId,
      method: input.method,
      email: input.email,
      phone: input.phone,
      name: defaultName(input),
    };
    setUser(next);
    // Keep the cookie/localStorage owner id pinned to the user's id so future
    // server reads see the same value.
    setOwnerId(ownerId);

    if (!isReturning) {
      setShowWelcome(true);
      try {
        localStorage.setItem(WELCOME_KEY, "1");
      } catch {
        // Non-fatal; the in-memory flag still drives this session's modal.
      }
      if (key !== null) {
        known.add(key);
        writeKnownIdentities(known);
      }
    } else {
      // Returning member — make sure no stale welcome flag fires.
      setShowWelcome(false);
      try {
        localStorage.removeItem(WELCOME_KEY);
      } catch {
        // Non-fatal.
      }
    }
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    setShowWelcome(false);
    // Intentionally keep the owner id intact. A signed-out browser is back to
    // being a "guest" — orders placed in this state should still attach to
    // the same id, so when the same person signs in again (or registers)
    // their full history follows them.
  }, []);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try {
      localStorage.removeItem(WELCOME_KEY);
    } catch {
      // Non-fatal; the in-memory flag is already cleared.
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      hydrated,
      user,
      isAuthenticated: user !== null,
      showWelcome,
      signIn,
      signOut,
      dismissWelcome,
    }),
    [hydrated, user, showWelcome, signIn, signOut, dismissWelcome],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
