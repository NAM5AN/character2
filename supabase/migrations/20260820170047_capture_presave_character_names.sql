-- Preserve the character name supplied at the start of analysis, even when an AI
-- stage fails before the character receives a share code and is saved.

alter table public.character2_gen_failures
  add column if not exists character_name text;

alter table public.character2_gen_inflight
  add column if not exists character_name text;

-- Keep the existing six-argument writer available during a rolling deployment.
-- The app switches to this server-secret-protected overload once the migration is live.
create or replace function public.character2_log_gen_failure(
  p_stage text,
  p_share_code text,
  p_session_id uuid,
  p_error_code text,
  p_error_detail text,
  p_kind text,
  p_character_name text,
  p_telemetry_secret text
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if encode(extensions.digest(coalesce(p_telemetry_secret, ''), 'sha256'), 'hex')
    <> '669ef73537cd1dfe38d030b58fdfa22534d80c55b47d36fe0e0d4f3042ae8c78' then
    raise exception 'TELEMETRY_AUTH_INVALID';
  end if;

  insert into public.character2_gen_failures(
    stage,
    share_code,
    session_id,
    error_code,
    error_detail,
    kind,
    character_name
  )
  values (
    left(coalesce(nullif(trim(p_stage), ''), 'unknown'), 80),
    nullif(upper(trim(coalesce(p_share_code, ''))), ''),
    p_session_id,
    left(coalesce(nullif(trim(p_error_code), ''), 'SERVER_ERROR'), 80),
    left(nullif(trim(coalesce(p_error_detail, '')), ''), 2000),
    case when lower(coalesce(p_kind, 'failure')) = 'retry' then 'retry' else 'failure' end,
    left(nullif(trim(coalesce(p_character_name, '')), ''), 80)
  );

  delete from public.character2_gen_failures
  where created_at < now() - interval '30 days';
end; $$;

revoke all on function public.character2_log_gen_failure(text,text,uuid,text,text,text,text,text) from public, authenticated;
grant execute on function public.character2_log_gen_failure(text,text,uuid,text,text,text,text,text) to anon;

-- The protected heartbeat likewise keeps the old four-argument overload working
-- until every running function instance has moved to the new application version.
create or replace function public.character2_gen_inflight_begin(
  p_id uuid,
  p_stage text,
  p_share_code text,
  p_session_id uuid,
  p_character_name text,
  p_telemetry_secret text
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if encode(extensions.digest(coalesce(p_telemetry_secret, ''), 'sha256'), 'hex')
    <> '669ef73537cd1dfe38d030b58fdfa22534d80c55b47d36fe0e0d4f3042ae8c78' then
    raise exception 'TELEMETRY_AUTH_INVALID';
  end if;

  insert into public.character2_gen_inflight(
    id,
    stage,
    share_code,
    session_id,
    character_name
  )
  values (
    p_id,
    left(coalesce(nullif(trim(p_stage), ''), 'unknown'), 80),
    nullif(upper(trim(coalesce(p_share_code, ''))), ''),
    p_session_id,
    left(nullif(trim(coalesce(p_character_name, '')), ''), 80)
  )
  on conflict (id) do nothing;

  delete from public.character2_gen_inflight
  where started_at < now() - interval '7 days';
end; $$;

revoke all on function public.character2_gen_inflight_begin(uuid,text,text,uuid,text,text) from public, authenticated;
grant execute on function public.character2_gen_inflight_begin(uuid,text,text,uuid,text,text) to anon;

create or replace function public.character2_gen_inflight_end(
  p_id uuid,
  p_telemetry_secret text
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if encode(extensions.digest(coalesce(p_telemetry_secret, ''), 'sha256'), 'hex')
    <> '669ef73537cd1dfe38d030b58fdfa22534d80c55b47d36fe0e0d4f3042ae8c78' then
    raise exception 'TELEMETRY_AUTH_INVALID';
  end if;

  delete from public.character2_gen_inflight where id = p_id;
end; $$;

revoke all on function public.character2_gen_inflight_end(uuid,text) from public, authenticated;
grant execute on function public.character2_gen_inflight_end(uuid,text) to anon;

create or replace function public.character2_admin_gen_failures(p_token text, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_rollup jsonb;
  v_recent jsonb;
  v_stuck jsonb;
  v_retries jsonb;
  v_retry_24h integer;
  v_total_24h integer;
  v_total_7d integer;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  select count(*) into v_total_24h
  from public.character2_gen_failures
  where kind = 'failure' and created_at >= now() - interval '24 hours';

  select count(*) into v_total_7d
  from public.character2_gen_failures
  where kind = 'failure' and created_at >= now() - interval '7 days';

  select count(*) into v_retry_24h
  from public.character2_gen_failures
  where kind = 'retry' and created_at >= now() - interval '24 hours';

  select coalesce(jsonb_agg(g order by g_count desc, g_last desc), '[]'::jsonb) into v_rollup
  from (
    select jsonb_build_object(
             'stage', stage,
             'errorCode', error_code,
             'count', count(*),
             'lastSeen', max(created_at)
           ) as g,
           count(*) as g_count,
           max(created_at) as g_last
    from public.character2_gen_failures
    where kind = 'failure' and created_at >= now() - interval '7 days'
    group by stage, error_code
  ) s;

  select coalesce(jsonb_agg(r order by r_at desc), '[]'::jsonb) into v_retries
  from (
    select jsonb_build_object(
             'id', f.id,
             'createdAt', f.created_at,
             'stage', f.stage,
             'shareCode', coalesce(f.share_code, us.share_code, c.share_code),
             'errorCode', f.error_code,
             'errorDetail', f.error_detail,
             'characterName', coalesce(
               nullif(trim(f.character_name), ''),
               nullif(trim(p.passport_json #>> '{basicProfile,name}'), ''),
               nullif(trim(c.name), '')
             ),
             'ownerName', c.owner_name
           ) as r,
           f.created_at as r_at
    from public.character2_gen_failures f
    left join public.character2_ai_usage_sessions us on us.usage_session_id = f.session_id
    left join public.character2_characters c
      on c.id = us.character_id
      or (us.character_id is null and c.share_code = f.share_code)
    left join public.character2_passports p on p.character_id = c.id
    where f.kind = 'retry'
      and f.created_at >= now() - interval '7 days'
    order by f.created_at desc
    limit v_limit
  ) t;

  select coalesce(jsonb_agg(r order by r_at desc), '[]'::jsonb) into v_recent
  from (
    select jsonb_build_object(
             'id', f.id,
             'createdAt', f.created_at,
             'stage', f.stage,
             'shareCode', coalesce(f.share_code, us.share_code, c.share_code),
             'errorCode', f.error_code,
             'errorDetail', f.error_detail,
             'characterName', coalesce(
               nullif(trim(f.character_name), ''),
               nullif(trim(p.passport_json #>> '{basicProfile,name}'), ''),
               nullif(trim(c.name), '')
             ),
             'ownerName', c.owner_name
           ) as r,
           f.created_at as r_at
    from public.character2_gen_failures f
    left join public.character2_ai_usage_sessions us on us.usage_session_id = f.session_id
    left join public.character2_characters c
      on c.id = us.character_id
      or (us.character_id is null and c.share_code = f.share_code)
    left join public.character2_passports p on p.character_id = c.id
    where f.kind = 'failure'
    order by f.created_at desc
    limit v_limit
  ) t;

  select coalesce(jsonb_agg(k order by k_at desc), '[]'::jsonb) into v_stuck
  from (
    select jsonb_build_object(
             'id', i.id,
             'startedAt', i.started_at,
             'stage', i.stage,
             'shareCode', coalesce(i.share_code, us.share_code, c.share_code),
             'minutesStuck', round(extract(epoch from (now() - i.started_at)) / 60)::integer,
             'characterName', coalesce(
               nullif(trim(i.character_name), ''),
               nullif(trim(p.passport_json #>> '{basicProfile,name}'), ''),
               nullif(trim(c.name), '')
             ),
             'ownerName', c.owner_name
           ) as k,
           i.started_at as k_at
    from public.character2_gen_inflight i
    left join public.character2_ai_usage_sessions us on us.usage_session_id = i.session_id
    left join public.character2_characters c
      on c.id = us.character_id
      or (us.character_id is null and c.share_code = i.share_code)
    left join public.character2_passports p on p.character_id = c.id
    where i.started_at < now() - interval '6 minutes'
    order by i.started_at desc
    limit 100
  ) u;

  return jsonb_build_object(
    'total24h', v_total_24h,
    'total7d', v_total_7d,
    'rollup', v_rollup,
    'recent', v_recent,
    'stuck', v_stuck,
    'retry24h', v_retry_24h,
    'retries', v_retries
  );
end; $$;

revoke all on function public.character2_admin_gen_failures(text,integer) from public, authenticated;
grant execute on function public.character2_admin_gen_failures(text,integer) to anon;
