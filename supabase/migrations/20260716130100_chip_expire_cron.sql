-- Auto-expire abandoned CHIP payment attempts. The expire_awaiting_payment()
-- function (already in prod) cancels awaiting_payment orders older than 30 min,
-- reversing any settled rewards first. Because it is a plain SECURITY DEFINER SQL
-- function, pg_cron calls it DIRECTLY — no App Service round-trip, no shared
-- secret, no Vault entry needed (unlike the shift reminder, which must hit an
-- HTTP route to decide + send a Telegram message).
--
-- Re-runnable: unschedules any existing 'chip-expire-abandoned' job first.

create extension if not exists pg_cron;

select cron.unschedule('chip-expire-abandoned')
where exists (select 1 from cron.job where jobname = 'chip-expire-abandoned');

-- Every 15 minutes, at minutes off the :00 mark (7,22,37,52) to avoid piling on
-- the top-of-hour cron rush.
select cron.schedule(
  'chip-expire-abandoned',
  '7,22,37,52 * * * *',
  $job$ select public.expire_awaiting_payment(); $job$
);
