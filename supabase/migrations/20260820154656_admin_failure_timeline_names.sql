-- Show retry/failure telemetry as a real timeline in the admin console.
-- A generation session can receive its character only after the failed/retried AI
-- call, so fall back through character2_ai_usage_sessions when share_code was not
-- available on the original telemetry row.

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

  -- Keep the stage/error summary for at-a-glance counts.
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

  -- Retry rows are intentionally not grouped: newest first, with one character per row.
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

  -- Terminal failures use the same session fallback and are newest first.
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

  -- Keep the separate stuck list, but follow the same newest-first admin ordering.
  select coalesce(jsonb_agg(k order by k_at desc), '[]'::jsonb) into v_stuck
  from (
    select jsonb_build_object(
             'id', i.id,
             'startedAt', i.started_at,
             'stage', i.stage,
             'shareCode', coalesce(i.share_code, us.share_code, c.share_code),
             'minutesStuck', round(extract(epoch from (now() - i.started_at)) / 60)::integer,
             'characterName', coalesce(
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

revoke all on function public.character2_admin_gen_failures(text,integer) from public;
grant execute on function public.character2_admin_gen_failures(text,integer) to anon;
