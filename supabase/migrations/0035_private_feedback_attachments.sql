-- Keep feedback attachments in a private bucket.
-- Upload remains anonymous so users can submit files. Reads require a signed URL.

update storage.buckets
set public = false,
    file_size_limit = 31457280,
    allowed_mime_types = array['image/*','video/*']::text[]
where id = 'character2-feedback';

-- A private bucket never exposes /object/public URLs. Signed URL creation requires
-- SELECT permission on the object. Paths are unguessable UUIDs and object listing is
-- not granted; additionally only objects whose feedback UUID exists may be selected.
drop policy if exists character2_feedback_read_for_signing on storage.objects;
create policy character2_feedback_read_for_signing
on storage.objects for select to anon
using (
  bucket_id = 'character2-feedback'
  and exists (
    select 1
    from public.character2_feedback_reports f
    where f.id::text = coalesce((storage.foldername(name))[1], '')
  )
);
