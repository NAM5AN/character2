-- Admin console: owner-only management surface.
-- No credentials are stored in this migration. The login hash lives only in the
-- character2_app_settings.admin_login_hash column and is set out-of-band, so the
-- repository never reveals the access method or the credential values.

alter table public.character2_app_settings
  add column if not exists admin_login_hash text not null default '';

create table if not exists public.character2_admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.character2_admin_sessions enable row level security;
revoke all on table public.character2_admin_sessions from anon, authenticated;

-- Verify the (character name, owner name) pair against the stored hash and, on
-- success, open a 12h session bound to the supplied random token.
create or replace function public.character2_admin_login(p_name text, p_owner_name text, p_token text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_ok boolean;
begin
  select exists (
    select 1 from public.character2_app_settings s
    where s.id = 1
      and length(coalesce(s.admin_login_hash, '')) = 64
      and s.admin_login_hash = encode(extensions.digest(
        lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
        || chr(31) ||
        lower(regexp_replace(btrim(coalesce(p_owner_name, '')), '\s+', ' ', 'g')),
        'sha256'), 'hex')
  ) into v_ok;
  if not v_ok then return false; end if;
  if length(coalesce(p_token, '')) < 16 then return false; end if;
  delete from public.character2_admin_sessions where expires_at < now();
  insert into public.character2_admin_sessions(token_hash, expires_at)
  values (encode(extensions.digest(p_token, 'sha256'), 'hex'), now() + interval '12 hours')
  on conflict (token_hash) do update set expires_at = excluded.expires_at;
  return true;
end; $$;

create or replace function public.character2_admin_session_ok(p_token text)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.character2_admin_sessions
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and expires_at > now()
  );
$$;

create or replace function public.character2_admin_logout(p_token text)
returns boolean
language sql security definer set search_path = public, extensions
as $$
  delete from public.character2_admin_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select true;
$$;

-- Full live listing of every stored character, gated by a valid admin session.
create or replace function public.character2_admin_list(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare result jsonb;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  select coalesce(jsonb_agg(row_data order by sort_created_at desc), '[]'::jsonb) into result
  from (
    select
      c.created_at as sort_created_at,
      jsonb_build_object(
        'shareCode', c.share_code,
        'name', coalesce(p.passport_json #>> '{basicProfile,name}', c.name),
        'ownerName', c.owner_name,
        'status', c.status,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at,
        'analysisConfidence', p.analysis_confidence,
        'publicProfile', coalesce(p.passport_json #>> '{basicProfile,profileText}', ''),
        'secretProfile', coalesce(
          r.source_json #>> '{secretProfileText}',
          p.passport_json #>> '{basicProfile,secretProfileText}',
          ''
        ),
        'oneLineSummary', coalesce(p.passport_json #>> '{analysis,oneLineSummary}', ''),
        'summary', p.passport_json #> '{analysis,summary}',
        'inferences', coalesce(p.passport_json #> '{aiInferences}', '[]'::jsonb),
        'answers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order', a.question_order,
            'question', a.question_text,
            'answer', a.answer_json ->> 'answer',
            'reason', a.answer_json ->> 'reason'
          ) order by a.question_order)
          from public.character2_answers a
          where a.character_id = c.id
        ), '[]'::jsonb),
        'detailReport', case
          when r.detail_json is not null and jsonb_typeof(r.detail_json) = 'object'
            then r.detail_json - '_detailDossier'
          else null
        end,
        'detailGeneratedAt', r.detail_generated_at
      ) as row_data
    from public.character2_characters c
    left join public.character2_passports p on p.character_id = c.id
    left join public.character2_private_reports r on r.character_id = c.id
  ) t;

  return result;
end; $$;

create or replace function public.character2_admin_delete(p_token text, p_share_code text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;
  select id into v_id from public.character2_characters
  where share_code = upper(trim(p_share_code)) limit 1;
  if v_id is null then return false; end if;
  delete from public.character2_characters where id = v_id;
  return true;
end; $$;

revoke all on function public.character2_admin_login(text, text, text) from public;
revoke all on function public.character2_admin_session_ok(text) from public;
revoke all on function public.character2_admin_logout(text) from public;
revoke all on function public.character2_admin_list(text) from public;
revoke all on function public.character2_admin_delete(text, text) from public;

grant execute on function public.character2_admin_login(text, text, text) to anon;
grant execute on function public.character2_admin_session_ok(text) to anon;
grant execute on function public.character2_admin_logout(text) to anon;
grant execute on function public.character2_admin_list(text) to anon;
grant execute on function public.character2_admin_delete(text, text) to anon;
