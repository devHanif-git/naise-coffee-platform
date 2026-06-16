-- Tracks the one-time welcome modal at the account level (not per-device).
-- NULL = never greeted. An atomic conditional update (set ... where welcomed_at
-- is null returning id) lets exactly one caller "claim" the greeting, which
-- kills the refocus re-emit race without any time window or client-side guard.
alter table public.profiles
  add column welcomed_at timestamptz;

comment on column public.profiles.welcomed_at is
  'When the one-time welcome modal was shown. NULL = not yet greeted. Claimed atomically so it fires exactly once per account.';
