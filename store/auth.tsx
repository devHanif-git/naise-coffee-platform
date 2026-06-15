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

const AUTH_KEY = "naise-auth";
// Set the moment a guest becomes a member; consumed once to show the welcome
// modal, then cleared. Kept separate from the user record so signing out and
// back in (an existing member) never re-triggers the new-user celebration.
const WELCOME_KEY = "naise-auth-welcome";

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
    const next: AuthUser = {
      id: crypto.randomUUID(),
      method: input.method,
      email: input.email,
      phone: input.phone,
      name: defaultName(input),
    };
    setUser(next);
    // Arm the one-time welcome. In the mock there's no existing-account
    // lookup, so every sign-in is treated as a new member; the flag itself
    // guarantees it only ever fires once per browser.
    setShowWelcome(true);
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      // Non-fatal; the in-memory flag still drives this session's modal.
    }
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    setShowWelcome(false);
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
