-- Normalize orders.payment_method to canonical method ids.
--
-- The online checkout previously stored the display name ("DuitNow QR", and a
-- casing variant "Duitnow QR"), while the in-store kiosk stored the method id
-- ("duitnow-qr"). Reports group by this column, so the same method showed up as
-- several separate rows. Collapse every known display name (case-insensitive,
-- trimmed) to its id. New orders already store the id from both surfaces.

update orders set payment_method = 'cash'
  where lower(trim(payment_method)) = 'cash' and payment_method <> 'cash';

update orders set payment_method = 'duitnow-qr'
  where lower(trim(payment_method)) = 'duitnow qr' and payment_method <> 'duitnow-qr';

update orders set payment_method = 'bank-transfer'
  where lower(trim(payment_method)) = 'bank transfer' and payment_method <> 'bank-transfer';

update orders set payment_method = 'apple-pay'
  where lower(trim(payment_method)) = 'apple pay' and payment_method <> 'apple-pay';

update orders set payment_method = 'google-pay'
  where lower(trim(payment_method)) = 'google pay' and payment_method <> 'google-pay';

update orders set payment_method = 'tng-ewallet'
  where lower(trim(payment_method)) = 'touch ''n go ewallet' and payment_method <> 'tng-ewallet';

update orders set payment_method = 'boost'
  where lower(trim(payment_method)) = 'boost' and payment_method <> 'boost';

update orders set payment_method = 'grabpay'
  where lower(trim(payment_method)) = 'grabpay' and payment_method <> 'grabpay';
