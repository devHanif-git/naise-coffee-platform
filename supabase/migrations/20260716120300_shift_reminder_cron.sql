-- Scheduled Telegram shift reminders. pg_cron fires every 30 min and, via
-- pg_net, POSTs the App Service reminder route with the shared secret. The route
-- decides whether a message is actually due (past-midnight-KL close reminder;
-- one-time open nudge 12h after close). Secrets live in the App Service, not here.
--
-- *** MANUAL / OUT-OF-BAND MIGRATION ***
-- This file is NOT applied by an unattended `supabase db push` — it references a
-- Vault secret that must exist first. Apply it by hand once the two secrets are
-- set (Supabase Dashboard -> Project Settings -> Vault):
--   * shift_site_url        e.g. https://naise-coffee.azurewebsites.net
--   * shift_cron_secret     the same random string as the App Service
--                           SHIFT_CRON_SECRET env var
-- Re-runnable: unschedules any existing 'shift-reminder' job first.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop the previous schedule if present so re-applying doesn't error/duplicate.
select cron.unschedule('shift-reminder')
where exists (select 1 from cron.job where jobname = 'shift-reminder');

-- Runs at minute 3 and 33 of every hour (off the :00/:30 marks). URL + secret
-- are read from Vault at schedule time, so nothing sensitive is stored in the
-- job definition in plaintext beyond what Vault already protects.
select cron.schedule(
  'shift-reminder',
  '3,33 * * * *',
  format(
    $job$
    select net.http_post(
      url     := %L || '/api/shift/reminder',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-shift-cron-secret', %L),
      body    := '{}'::jsonb
    );
    $job$,
    (select decrypted_secret from vault.decrypted_secrets where name = 'shift_site_url'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'shift_cron_secret')
  )
);
