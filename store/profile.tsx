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
import { mockProfile } from "@/data/profile";

const PROFILE_KEY = "naise-profile";

type ProfileContextValue = {
  // True once the persisted profile has loaded from localStorage.
  hydrated: boolean;
  profile: CustomerProfile;
  // Merges a partial edit (display name / avatar) into the stored profile.
  updateProfile: (edit: ProfileEdit) => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  // Start from the mock so the first client render matches the server HTML; the
  // persisted profile loads in the effect below (same approach as the Beans
  // store, avoiding a hydration mismatch).
  const [profile, setProfile] = useState<CustomerProfile>(mockProfile);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
        setProfile({ ...mockProfile, ...(JSON.parse(raw) as CustomerProfile) });
      }
    } catch {
      // Ignore malformed/unavailable storage; keep the mock starting value.
    }
    setHydrated(true);
  }, []);

  // Persist after the initial load so we never clobber stored values with the
  // mock starting state.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // Storage may be full/unavailable; profile still works in-memory.
    }
  }, [profile, hydrated]);

  const updateProfile = useCallback((edit: ProfileEdit) => {
    setProfile((prev) => ({ ...prev, ...edit }));
  }, []);

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
