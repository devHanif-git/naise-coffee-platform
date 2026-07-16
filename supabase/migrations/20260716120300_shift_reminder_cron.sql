-- Scheduled Telegram shift reminders. pg_cron fires every 30 min and, via
-- pg_net, POSTs the App Service reminder route with the shared secret. The route
-- decides whether a message is actually due (past-midnight-KL close reminder;
-- one-time open nudge 12h after close). Secrets live in the App Service, not here.
--
-- Before applying, substitute the two placeholders below (or read them from
-- vault.decrypted_secrets): the site URL and the shared secret matching the
-- SHIFT_CRON_SECRET env var on the App Service.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Runs at minute 3 and 33 of every hour (off the :00/:30 marks).
select cron.schedule(
  'shift-reminder',
  '3,33 * * * *',
  $$
  select net.http_post(
    url     := '<SITE_URL>/api/shift/reminder',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-shift-cron-secret', '<SHIFT_CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);
