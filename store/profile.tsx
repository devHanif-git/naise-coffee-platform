"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CustomerProfile, ProfileEdit } from "@/types/profile";
import { useAuth } from "@/store/auth";
import { createClient } from "@/lib/supabase/client";

type ProfileContextValue = {
  // True once the profile row has been fetched for the signed-in user (or we've
  // settled that there's no signed-in user). Lets the UI avoid flashing stale
  // values before the real profile loads.
  hydrated: boolean;
  profile: CustomerProfile;
  // Persists a partial edit (display name / avatar) to the `profiles` row and
  // updates local state. Throws on failure so the caller can surface an error.
  updateProfile: (edit: ProfileEdit) => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

// Fallback shown for guests / before the first fetch resolves. Members never
// see these values — the real row replaces them as soon as it loads.
const EMPTY_PROFILE: CustomerProfile = {
  displayName: "Naise Member",
  memberSince: new Date().toISOString(),
};

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user, hydrated: authHydrated } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile>(EMPTY_PROFILE);
  const [hydrated, setHydrated] = useState(false);
  const [supabase] = useState(() => createClient());

  // Load the signed-in user's profile row from Supabase. Re-runs whenever the
  // signed-in identity changes (sign-in / sign-out / account switch).
  useEffect(() => {
    if (!authHydrated) return;

    // Guests have no profile row; reset to the fallback and mark hydrated.
    if (!user) {
      /* eslint-disable react-hooks/set-state-in-effect -- synchronous reset on sign-out; no cascade risk */
      setProfile(EMPTY_PROFILE);
      setHydrated(true);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    let active = true;
    setHydrated(false);

    // maybeSingle() returns null (not a PGRST116 error) when the row is absent,
    // so we can distinguish "row missing" from a real query failure. A signed-in
    // user must always have a profile row (the signup trigger creates it); if
    // it's somehow gone — e.g. deleted in the dashboard — we self-heal by
    // recreating it from the session identity rather than showing stale data.
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, avatar_url, phone, created_at")
        .eq("id", user.id)
        .maybeSingle();
      if (!active) return;

      if (error) {
        // Genuine query/RLS failure (not a missing row). Fall back to the
        // session identity so the screen still shows something real.
        setProfile({
          displayName: user.name,
          avatarUrl: user.avatarUrl,
          memberSince: user.createdAt ?? new Date().toISOString(),
        });
        setHydrated(true);
        return;
      }

      if (data) {
        setProfile({
          displayName: data.display_name ?? user.name,
          avatarUrl: data.avatar_url ?? undefined,
          memberSince: data.created_at ?? new Date().toISOString(),
          phone: data.phone ?? undefined,
        });
        setHydrated(true);
        return;
      }

      // Row missing — recreate it from the session identity (insert_self RLS
      // allows a user to create their own row). Keeps the invariant intact so
      // edits below always have a row to write to.
      const { data: healed } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          display_name: user.name,
          avatar_url: user.avatarUrl ?? null,
        })
        .select("display_name, avatar_url, phone, created_at")
        .single();
      if (!active) return;

      setProfile({
        displayName: healed?.display_name ?? user.name,
        avatarUrl: healed?.avatar_url ?? user.avatarUrl,
        memberSince: healed?.created_at ?? user.createdAt ?? new Date().toISOString(),
        phone: healed?.phone ?? undefined,
      });
      setHydrated(true);
    })();

    return () => {
      active = false;
    };
    // Keyed on the user *id*, not the whole user object. Supabase re-validates
    // the session on tab refocus and fires an auth event, which rebuilds the
    // user object (new reference, same id). Depending on the object would
    // re-run this effect on every refocus — flipping `hydrated` back to false
    // and replaying the skeleton. Keying on the id only re-fetches on a real
    // identity change (sign-in / sign-out / account switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authHydrated, supabase]);

  // Persist an edit to the `profiles` row (RLS allows self-update only), then
  // mirror it into local state. No-op for guests (no row to write).
  const updateProfile = useCallback(
    async (edit: ProfileEdit) => {
      if (!user) return;
      // Only persist the keys this edit actually provided, so a partial update
      // (e.g. the checkout nudge writing just `phone`) never clobbers the other
      // columns. A present key with an undefined value means "clear it" → null.
      const payload: {
        id: string;
        display_name?: string;
        avatar_url?: string | null;
        phone?: string | null;
      } = { id: user.id };
      if ("displayName" in edit && edit.displayName !== undefined) {
        payload.display_name = edit.displayName;
      }
      if ("avatarUrl" in edit) payload.avatar_url = edit.avatarUrl ?? null;
      if ("phone" in edit) payload.phone = edit.phone ?? null;

      // Upsert (not update): a plain UPDATE matching zero rows succeeds with 0
      // rows affected and throws nothing, so a deleted row would silently fail
      // to persist while the UI looked saved. Upserting recreates the row if
      // missing. The .select().single() confirms what actually landed and
      // surfaces an error if nothing did (e.g. RLS denial).
      const { data, error } = await supabase
        .from("profiles")
        .upsert(payload)
        .select("display_name, avatar_url, phone, created_at")
        .single();
      if (error) throw error;
      setProfile((prev) => ({
        ...prev,
        displayName: data.display_name ?? edit.displayName ?? prev.displayName,
        avatarUrl: data.avatar_url ?? undefined,
        memberSince: data.created_at ?? prev.memberSince,
        // Mirror the DB exactly — `data` is the returned row, so a cleared
        // number comes back null and must become undefined, not fall back to
        // the stale previous value.
        phone: data.phone ?? undefined,
      }));
    },
    [user, supabase],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({ hydrated, profile, updateProfile }),
    [hydrated, profile, updateProfile],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within a ProfileProvider");
  return ctx;
}
