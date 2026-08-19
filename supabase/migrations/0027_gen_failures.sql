-- Generation failure log for the admin console.
-- The vast majority of runtime errors are AI generation failures
-- (AI_JSON_SCHEMA_FAILED, gateway credit/402, gateway 403, etc). Users hit these
-- mid-flow and silently drop off, and there was no in-product way to see it — only
-- Vercel logs. This records each failed AI generation attempt with the stage it
-- failed at and (when known) which character/session it belonged to, so the owner
-- can spot drop-offs from the admin console.
--
-- Every AI call is wrapped in withAiUsageContext (server), so failures are logged
-- from that single chokepoint via character2_log_gen_failure below.
-- NOTE: this cannot capture hard 300s function timeouts — those kill the process
-- before any catch runs, and remain visible only in Vercel logs.

create table if not exists public.character2_gen_failures (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  stage text not null,
  share_code text,          -- null when the failure happens before a character is saved (e.g. profile_parse)
  session_id uuid,          -- usage session id, when available
  error_code text not null,
  error_detail text
);

create index if not exists character2_gen_failures_created_idx
  on public.character2_gen_failures (created_at desc);

-- Access is only ever through the SECURITY DEFINER functions below, matching every
-- other character2_* table. RLS on + no policies blocks direct PostgREST access.
alter table public.character2_gen_failures enable row level security;

-- Best-effort failure logger. Called from the server on any AI generation failure.
-- Clamps field lengths and prunes rows older than 30 days so the table stays small.
create or replace function public.character2_log_gen_failure(
  p_stage text,
  p_share_code text,
  p_session_id uuid,
  p_error_code text,
  p_error_detail text
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  insert into public.character2_gen_failures(stage, share_code, session_id, error_code, error_detail)
  values (
    left(coalesce(nullif(trim(p_stage), ''), 'unknown'), 80),
    nullif(upper(trim(coalesce(p_share_code, ''))), ''),
    p_session_id,
    left(coalesce(nullif(trim(p_error_code), ''), 'SERVER_ERROR'), 80),
    left(nullif(trim(coalesce(p_error_detail, '')), ''), 1400)
  );
  delete from public.character2_gen_failures where created_at < now() - interval '30 days';
end; $$;

revoke all on function public.character2_log_gen_failure(text,text,uuid,text,text) from public;
grant execute on function public.character2_log_gen_failure(text,text,uuid,text,text) to anon;

-- Admin console reader: returns a rollup (by stage+code) and the recent rows,
-- enriched with the character name/owner when the share_code still resolves.
create or replace function public.character2_admin_gen_failures(p_token text, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_rollup jsonb;
  v_recent jsonb;
  v_total_24h integer;
  v_total_7d integer;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  select count(*) into v_total_24h from public.character2_gen_failures where created_at >= now() - interval '24 hours';
  select count(*) into v_total_7d  from public.character2_gen_failures where created_at >= now() - interval '7 days';

  -- Group by stage+code over the last 7 days, most frequent first.
  select coalesce(jsonb_agg(g order by g_count desc, g_last desc), '[]'::jsonb) into v_rollup
  from (
    select
      jsonb_build_object(
        'stage', stage,
        'errorCode', error_code,
        'count', count(*),
        'lastSeen', max(created_at)
      ) as g,
      count(*) as g_count,
      max(created_at) as g_last
    from public.character2_gen_failures
    where created_at >= now() - interval '7 days'
    group by stage, error_code
  ) s;

  -- Recent individual rows (across all retained history), newest first.
  select coalesce(jsonb_agg(r order by r_at desc), '[]'::jsonb) into v_recent
  from (
    select
      jsonb_build_object(
        'id', f.id,
        'createdAt', f.created_at,
        'stage', f.stage,
        'shareCode', f.share_code,
        'errorCode', f.error_code,
        'errorDetail', f.error_detail,
        'characterName', coalesce(p.passport_json #>> '{basicProfile,name}', c.name),
        'ownerName', c.owner_name
      ) as r,
      f.created_at as r_at
    from public.character2_gen_failures f
    left join public.character2_characters c on c.share_code = f.share_code
    left join public.character2_passports p on p.character_id = c.id
    order by f.created_at desc
    limit v_limit
  ) t;

  return jsonb_build_object(
    'total24h', v_total_24h,
    'total7d', v_total_7d,
    'rollup', v_rollup,
    'recent', v_recent
  );
end; $$;
