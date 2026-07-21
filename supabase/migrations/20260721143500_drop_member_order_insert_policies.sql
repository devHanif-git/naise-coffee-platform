-- Security remediation (part 2 of 2): remove members' direct order-insert path.
--
-- DEPLOY COUPLING: this migration MUST land together with the createOrder code
-- change that routes member order creation through the service-role client. On
-- its own, against the OLD app code, it breaks member checkout (the old code
-- inserts member orders under the cookie client, which these policies gate).
-- Apply it only when deploying the matching code. The earn-cap guard
-- (20260721130000) already blocks the Beans exploit ahead of this, so there is
-- no rush to apply this before the deploy.
--
-- With these dropped, members can only SELECT their own orders/items; all
-- creation flows through the trusted createOrder chokepoint (service-role),
-- which re-prices every line against the live catalogue. This also closes the
-- stamp/voucher variant (fabricated order + item -> grant_order_stamp).
drop policy if exists "orders_insert_self" on public.orders;
drop policy if exists "order_items_insert_self" on public.order_items;
