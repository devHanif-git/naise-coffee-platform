-- Third order channel: admin-placed custom orders. Joins 'online' (storefront)
-- and 'store' (in-store kiosk). Drives the source split in reports/dashboard.
alter type public.order_source add value if not exists 'custom';
