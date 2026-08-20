-- User-submitted bug/error/improvement reports with browser environment metadata.
-- Attachments use a dedicated storage bucket. Object names are random UUID paths;
-- listing is not exposed to users, while the admin console reads report metadata via RPC.

create table if not exists public.character2_feedback_reports (
  id uuid primary key,
  created_at timestamptz not null default now(),
  category text not null check (category in ('bug','error','improvement')),
  content text not null check (char_length(content) between 5 and 5000),
  environment jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new','read','resolved')),
  updated_at timestamptz not null default now()
);

create index if not exists character2_feedback_created_idx
  on public.character2_feedback_reports(created_at desc);
create index if not exists character2_feedback_status_idx
  on public.character2_feedback_reports(status, created_at desc);

alter table public.character2_feedback_reports enable row level security;
revoke all on table public.character2_feedback_reports from public, anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'character2-feedback',
  'character2-feedback',
  true,
  31457280,
  array['image/*','video/*']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists character2_feedback_upload on storage.objects;
create policy character2_feedback_upload
on storage.objects for insert to anon
with check (
  bucket_id = 'character2-feedback'
  and coalesce((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
);

create or replace function public.character2_submit_feedback(
  p_id uuid,
  p_category text,
  p_content text,
  p_environment jsonb,
  p_attachments jsonb
)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_category text := lower(trim(coalesce(p_category,'')));
  v_content text := trim(coalesce(p_content,''));
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
begin
  if p_id is null then return false; end if;
  if v_category not in ('bug','error','improvement') then return false; end if;
  if char_length(v_content) < 5 or char_length(v_content) > 5000 then return false; end if;
  if jsonb_typeof(v_attachments) <> 'array' or jsonb_array_length(v_attachments) > 4 then return false; end if;
  if exists (
    select 1
    from jsonb_array_elements(v_attachments) item
    where coalesce(item->>'path','') not like p_id::text || '/%'
      or coalesce(item->>'type','') !~* '^(image|video)/'
      or coalesce((item->>'size')::bigint, 0) < 0
      or coalesce((item->>'size')::bigint, 0) > 31457280
  ) then return false; end if;

  insert into public.character2_feedback_reports(id, category, content, environment, attachments)
  values (
    p_id,
    v_category,
    v_content,
    case when jsonb_typeof(p_environment) = 'object' then p_environment else '{}'::jsonb end,
    v_attachments
  )
  on conflict (id) do nothing;

  return found;
end; $$;

create or replace function public.character2_admin_feedback_list(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare result jsonb;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'createdAt', f.created_at,
    'category', f.category,
    'content', f.content,
    'environment', f.environment,
    'attachments', f.attachments,
    'status', f.status,
    'updatedAt', f.updated_at
  ) order by f.created_at desc), '[]'::jsonb)
  into result
  from public.character2_feedback_reports f;

  return result;
end; $$;

create or replace function public.character2_admin_feedback_status(
  p_token text,
  p_id uuid,
  p_status text
)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;
  if p_status not in ('new','read','resolved') then return false; end if;
  update public.character2_feedback_reports
  set status = p_status, updated_at = now()
  where id = p_id;
  return found;
end; $$;

revoke all on function public.character2_submit_feedback(uuid,text,text,jsonb,jsonb) from public;
revoke all on function public.character2_admin_feedback_list(text) from public;
revoke all on function public.character2_admin_feedback_status(text,uuid,text) from public;
grant execute on function public.character2_submit_feedback(uuid,text,text,jsonb,jsonb) to anon;
grant execute on function public.character2_admin_feedback_list(text) to anon;
grant execute on function public.character2_admin_feedback_status(text,uuid,text) to anon;
