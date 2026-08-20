-- Security hardening pass.
--
-- Context: this repository is public, and the server authenticates to Supabase with the
-- publishable (anon) key. That means every function granted to `anon` is callable
-- directly against PostgREST, bypassing the Next.js layer and its rate limiting. The
-- fixes below remove the parts of that surface nothing uses, slow down the one
-- credential check that must stay reachable, and stop leaking the owner's name to
-- anonymous visitors.

-- 1) Owner name is personal data and does not belong in the anonymous preview.
--    The character report itself stays publicly shareable; only the human behind it
--    is hidden. The owner's own editor reads it back through the token-gated
--    character2_get_owner_name below.
create or replace function public.character2_get_public_preview(p_share_code text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'name', coalesce(p.passport_json #>> '{basicProfile,name}', c.name),
    'shareCode', c.share_code,
    'oneLineSummary', coalesce(p.passport_json #>> '{analysis,oneLineSummary}', ''),
    'summary', case
      when jsonb_typeof(p.passport_json #> '{analysis,summary}') = 'object'
        then p.passport_json #> '{analysis,summary}'
      else jsonb_build_object(
        'outerSelf', left(coalesce(p.passport_json #>> '{analysis,outerSelf}', ''), 160),
        'innerSelf', left(coalesce(p.passport_json #>> '{analysis,innerSelf}', ''), 160),
        'conflictStyle', left(coalesce(p.passport_json #>> '{analysis,conflictStyle}', ''), 160),
        'affectionStyle', left(coalesce(p.passport_json #>> '{analysis,affectionStyle}', ''), 160)
      )
    end,
    'summaryTags', case
      when jsonb_typeof(p.passport_json #> '{analysis,summaryTags}') = 'object'
        then p.passport_json #> '{analysis,summaryTags}'
      else null
    end,
    'summaryCardLines', case
      when jsonb_typeof(p.passport_json #> '{analysis,summaryCardLines}') = 'object'
        then p.passport_json #> '{analysis,summaryCardLines}'
      else null
    end
  )
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
  limit 1;
$$;

-- Owner-only read of the owner name, so the report page can prefill its editor.
-- Mirrors the edit-token check used by character2_set_owner_name.
create or replace function public.character2_get_owner_name(p_share_code text, p_edit_token text)
returns text
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_name text;
begin
  if coalesce(length(p_edit_token), 0) < 16 then
    return null;
  end if;
  select c.owner_name into v_name
  from public.character2_characters c
  join public.character2_access a on a.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and a.edit_token_hash = encode(extensions.digest(p_edit_token, 'sha256'), 'hex')
  limit 1;
  return v_name;
end; $$;

revoke all on function public.character2_get_owner_name(text, text) from public;
grant execute on function public.character2_get_owner_name(text, text) to anon;

-- 2) Drop the admin entry points nothing calls any more. Each was reachable by anon
--    over PostgREST; two of them (create_session, update_settings) took the admin
--    secret directly and returned a pass/fail, making them unthrottled password
--    oracles, and admin_get_character returned raw passport/source/detail dumps.
--    The cookie-gated /api/admin/config + character2_admin_* session RPCs replace them.
drop function if exists public.character2_update_settings(text, text, text);
drop function if exists public.character2_admin_create_session(text, text);
drop function if exists public.character2_admin_end_session(text);
drop function if exists public.character2_admin_get_character(text, text);
drop function if exists public.character2_admin_list_characters(text, text, integer, integer);

-- 3) The generation-telemetry tables are written only through SECURITY DEFINER RPCs,
--    so anon never needs table rights. They are protected by RLS today, but the
--    grants mean a single accidental "disable RLS" would publish them. Remove them.
revoke all on table public.character2_gen_failures from anon, authenticated;
revoke all on table public.character2_gen_inflight from anon, authenticated;
revoke all on table public.character2_gen_timings from anon, authenticated;

-- 4) character2_admin_login has to stay anon-callable (the server uses the publishable
--    key), so it is the one credential check an attacker can hit directly, with no
--    HTTP-layer rate limit in front of it. Add a short sleep on failure only: a wrong
--    guess costs ~0.4s, cutting a direct brute force by orders of magnitude, while a
--    correct login stays instant. No lockout, so the owner can never be locked out by
--    someone else's attack.
-- Body is the deployed function verbatim (including the '\\s+' escaping and the
-- ON CONFLICT clause); the only change is the pg_sleep on a failed credential match.
create or replace function public.character2_admin_login(p_name text, p_owner_name text, p_token text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $function$
declare v_ok boolean;
begin
  select exists (
    select 1 from public.character2_app_settings s
    where s.id = 1
      and length(coalesce(s.admin_login_hash, '')) = 64
      and s.admin_login_hash = encode(extensions.digest(
        lower(regexp_replace(btrim(coalesce(p_name, '')), '\\s+', ' ', 'g'))
        || chr(31) ||
        lower(regexp_replace(btrim(coalesce(p_owner_name, '')), '\\s+', ' ', 'g')),
        'sha256'), 'hex')
  ) into v_ok;
  if not v_ok then perform pg_sleep(0.4); return false; end if;
  if length(coalesce(p_token, '')) < 16 then return false; end if;
  delete from public.character2_admin_sessions where expires_at < now();
  insert into public.character2_admin_sessions(token_hash, expires_at)
  values (encode(extensions.digest(p_token, 'sha256'), 'hex'), now() + interval '12 hours')
  on conflict (token_hash) do update set expires_at = excluded.expires_at;
  return true;
end; $function$;

revoke all on function public.character2_admin_login(text, text, text) from public;
grant execute on function public.character2_admin_login(text, text, text) to anon;
