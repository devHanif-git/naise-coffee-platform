-- Lock shift writes to the SECURITY DEFINER RPCs only.
--
-- The initial schema granted staff broad INSERT/UPDATE on shifts and INSERT on
-- shift_movements. But every legitimate mutation already goes through
-- open_shift / add_shift_movement / close_shift (security definer, so they
-- bypass RLS as the function owner). The broad policies left a direct PostgREST
-- write path open: a staff JWT could PATCH a closed shift back to 'open'
-- (reopening a reconciled drawer — a spec non-goal) or overwrite counted_cash /
-- expected_cash / cash_difference, and could INSERT movements against a closed
-- shift. Dropping the write policies closes that hole; the RPCs still work
-- (definer bypasses RLS) and reads keep their SELECT policy.

drop policy if exists "shifts_insert_staff" on public.shifts;
drop policy if exists "shifts_update_staff" on public.shifts;
drop policy if exists "shift_movements_insert_staff" on public.shift_movements;

-- SELECT policies remain: shifts_select_staff, shift_movements_select_staff.
