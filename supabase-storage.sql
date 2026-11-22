-- Run this in Supabase SQL Editor for the overflow media bucket.
-- The bucket is public so shared post/story/room media can be served by URL.
-- Only the Node.js upload server receives the service-role key; never put it in browser code.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'forever-media',
  'forever-media',
  true,
  52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No anonymous upload policy is added. Uploads are made only by the authenticated
-- server using its secret service-role key, after Firebase ID-token and quota checks.
