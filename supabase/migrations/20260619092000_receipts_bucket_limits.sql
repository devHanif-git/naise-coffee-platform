-- Bound the receipts bucket against storage abuse. The INSERT policy allows
-- anon + authenticated to upload (guests legitimately need to), so cap object
-- size and restrict to image types — the only thing receipts ever hold.
update storage.buckets
set file_size_limit = 5242880, -- 5 MB
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'receipts';
