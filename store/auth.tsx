"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import type { AuthMethod, AuthUser } from "@/types/auth";
import { getOrCreateOwnerId, setOwnerId } from "@/lib/auth/owner-id";
import { createClient } from "@/lib/supabase/client";

// Local mock session for the PHONE path only. Google now goes through real
// Supabase OAuth (no localStorage). Phone/OTP stays mocked until WhatsApp/WABA
// lands, so its session is still persisted here to survive reloads.
const PHONE_MOCK_KEY = "naise-auth-phone-mock";

type SignInInput = {
  method: AuthMethod;
  email?: string;
  phone?: string;
  name?: string;
};

type AuthContextValue = {
  // True once we've checked the Supabase session (and the phone mock). Lets the
  // UI avoid flashing the guest state before we know who's signed in.
  hydrated: boolean;
  user: AuthUser | null;
  isAuthenticated: boolean;
  // Whether a freshly-registered user is owed the one-time welcome modal.
  showWelcome: boolean;
  // MOCK sign-in — PHONE path only (the localStorage mock). Google uses real
  // Supabase OAuth via signInWithOAuth in the auth screen, not this.
  signIn: (input: SignInInput) => void;
  signOut: () => void;
  // Dismisses the one-time welcome modal (clears the flag so it never re-shows).
  dismissWelcome: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Maps a real Supabase session to the app's AuthUser shape. Name falls back
// through the Google identity fields, then email, then a friendly default.
function userFromSession(session: Session): AuthUser {
  const u = session.user;
  const meta = u.user_metadata ?? {};
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    u.email ||
    "Naise Member";
  // Google returns the avatar under `avatar_url` (and sometimes `picture`).
  const avatarUrl =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    undefined;
  const provider = (u.app_metadata?.provider as AuthMethod) ?? "google";
  return {
    id: u.id,
    method: provider === "phone" ? "phone" : "google",
    email: u.email ?? undefined,
    phone: u.phone ?? undefined,
    name,
    avatarUrl,
    // Real account creation time, drives the accurate "Member since" label.
    createdAt: u.created_at ?? undefined,
  };
}

// Atomically claims the one-time welcome greeting for a user. Flips
// profiles.welcomed_at from null -> now() and returns true ONLY for the single
// call that won the flip; every later call (tab refocus re-emitting SIGNED_IN,
// reload, a second device) matches zero rows and returns false. The DB enforces
// "exactly once per account" — no time window or client-side guard needed, and
// it's truly one-time across every device, not just this browser.
async function claimWelcome(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ welcomed_at: new Date().toISOString() })
    .eq("id", userId)
    .is("welcomed_at", null)
    .select("id");
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

function readPhoneMock(): AuthUser | null {
  try {
    const raw = localStorage.getItem(PHONE_MOCK_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Start signed-out so the first client render matches the server HTML; the
  // real session loads in the effect below (avoids a hydration mismatch).
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Stable client across renders/subscription lifetime. Lazy initializer so
  // the browser client is created exactly once (not on every render) without
  // touching a ref during render.
  const [supabase] = useState(() => createClient());
  const router = useRouter();

  useEffect(() => {
    // Every visitor gets an owner id from first paint so guest orders attribute
    // correctly even before they ever sign in. Unchanged from the mock era.
    getOrCreateOwnerId();

    let active = true;

    // Seed from the current Supabase session; fall back to the phone mock.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (session) {
        setUser(userFromSession(session));
        // Attempt the one-time welcome claim. This is the reliable path for the
        // OAuth redirect return and for reloads (where onAuthStateChange emits
        // INITIAL_SESSION, not SIGNED_IN). The claim is atomic and idempotent —
        // only the call that flips welcomed_at null -> now() shows the modal.
        claimWelcome(supabase, session.user.id).then((won) => {
          if (active && won) setShowWelcome(true);
        });
      } else {
        const mock = readPhoneMock();
        if (mock) setUser(mock);
      }
      setHydrated(true);
    });

    // Keep the session live. Fires on sign-in (incl. the OAuth redirect return),
    // token refresh, and sign-out. Phone-mock sign-ins don't touch Supabase, so
    // they're handled directly in signIn().
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT" || !session) {
        setUser(null);
        return;
      }
      setUser(userFromSession(session));
      // Try to claim the one-time welcome. supabase-js re-emits SIGNED_IN on
      // every tab refocus, but the claim is atomic — it only succeeds for the
      // single call that flips welcomed_at from null, so a refocus can never
      // re-pop the modal. No time window or client-side guard needed.
      if (event === "SIGNED_IN") {
        const userId = session.user.id;
        claimWelcome(supabase, userId).then((won) => {
          if (active && won) setShowWelcome(true);
        });
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  // MOCK — phone path only. Sets a local session and persists it so it survives
  // a reload (there's no Supabase session backing it yet). Google never calls
  // this. Remove when phone/OTP is wired to real Supabase auth.
  const signIn = useCallback((input: SignInInput) => {
    const ownerId = getOrCreateOwnerId();
    const next: AuthUser = {
      id: ownerId,
      method: input.method,
      email: input.email,
      phone: input.phone,
      name: input.name?.trim() || input.phone || "Naise Member",
    };
    setUser(next);
    setOwnerId(ownerId);
    try {
      localStorage.setItem(PHONE_MOCK_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal; session still works in-memory for this tab.
    }
    // Phone mock: show the welcome on sign-in. Unlike the real path, signIn is
    // only ever called from an explicit button press (never by onAuthStateChange
    // on refocus), so there's no re-trigger to guard against. The mock has no DB
    // row, so the atomic welcomed_at claim doesn't apply here.
    setShowWelcome(true);
  }, []);

  const signOut = useCallback(async () => {
    // Did a real Supabase session exist? The phone path is still a local mock
    // with no Supabase session — only real members had their device's guest
    // orders re-owned to their account at sign-in, so only they need a fresh
    // guest identity here.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const hadRealSession = session !== null;

    // Clear the real Supabase session (no-op if only the phone mock is active).
    await supabase.auth.signOut();
    setUser(null);
    setShowWelcome(false);
    try {
      localStorage.removeItem(PHONE_MOCK_KEY);
    } catch {
      // Non-fatal.
    }
    // A real member's device orders were re-owned to their account at sign-in,
    // so this browser must start a fresh guest identity — otherwise the claimed
    // orders would still surface here, and a later sign-in could merge another
    // guest's orders into the account. The phone mock keeps its id so its guest
    // orders stay visible.
    if (hadRealSession) {
      setOwnerId(crypto.randomUUID());
    }
    // Re-run Server Components for the current route AFTER rotating the owner id
    // above, so server-rendered, session-scoped data (e.g. the profile's recent
    // orders, read from the cookie) reflects the signed-out state immediately
    // instead of showing the previous member's data until a manual reload.
    router.refresh();
  }, [supabase, router]);

  const dismissWelcome = useCallback(() => {
    // Just clear the in-memory flag. The persistent greeted record was written
    // at arm-time, so dismissal doesn't need to touch storage — and crucially,
    // a later refocus that re-emits SIGNED_IN won't re-arm because the user id
    // is already recorded as greeted.
    setShowWelcome(false);
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
