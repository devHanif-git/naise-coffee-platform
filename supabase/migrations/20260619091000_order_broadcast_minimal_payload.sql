-- Slim the per-order status broadcast payload.
--
-- The old trigger used realtime.broadcast_changes(), which emits the FULL new/old
-- order rows to every client subscribed to `order:<token>` — including
-- owner_id and the signed receipt URL. The customer tracking client only needs a
-- nudge to refetch (it calls router.refresh()), so emit a minimal payload with
-- realtime.send() instead and stop leaking row data over the channel.
create or replace function public.broadcast_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('status', new.status, 'completed_at', new.completed_at),
    tg_op,                          -- event
    'order:' || new.token::text,    -- topic
    true                            -- private
  );
  return new;
end;
$$;
