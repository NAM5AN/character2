-- Retries are invisible today: generateValidatedJson swallows a failed attempt and
-- silently re-sends the whole prompt, so a run that needs 2-3 attempts costs 2-3x and
-- we never learn why. Usage data shows ~26-36% of calls retry, and one summary run
-- burned 7 attempts that all came back truncated. Log the reason for each retried
-- attempt so the recurring rule violations can be targeted.
--
-- Reuses character2_gen_failures but tags rows with `kind` so the existing meaning of
-- that table (user-facing drop-offs) is untouched: kind='failure' stays the terminal
-- failure, kind='retry' is an attempt that failed but was retried.

alter table public.character2_gen_failures
  add column if not exists kind text not null default 'failure';

create index if not exists character2_gen_failures_kind_created_idx
  on public.character2_gen_failures (kind, created_at desc);

-- Writer gains an optional kind; existing 5-arg callers keep logging terminal failures.
create or replace function public.character2_log_gen_failure(
  p_stage text,
  p_share_code text,
  p_session_id uuid,
  p_error_code text,
  p_error_detail text,
  p_kind text default 'failure'
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  insert into public.character2_gen_failures(stage, share_code, session_id, error_code, error_detail, kind)
  values (
    left(coalesce(nullif(trim(p_stage), ''), 'unknown'), 80),
    nullif(upper(trim(coalesce(p_share_code, ''))), ''),
    p_session_id,
    left(coalesce(nullif(trim(p_error_code), ''), 'SERVER_ERROR'), 80),
    left(nullif(trim(coalesce(p_error_detail, '')), ''), 2000),
    case when lower(coalesce(p_kind, 'failure')) = 'retry' then 'retry' else 'failure' end
  );
  delete from public.character2_gen_failures where created_at < now() - interval '30 days';
end; $$;

revoke all on function public.character2_log_gen_failure(text,text,uuid,text,text,text) from public;
grant execute on function public.character2_log_gen_failure(text,text,uuid,text,text,text) to anon;

-- Admin reader: failure counts now exclude retries, and a separate retry rollup is
-- returned so the console can show which rule keeps costing an extra generation.
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

  select count(*) into v_total_24h from public.character2_gen_failures
    where kind = 'failure' and created_at >= now() - interval '24 hours';
  select count(*) into v_total_7d from public.character2_gen_failures
    where kind = 'failure' and created_at >= now() - interval '7 days';
  select count(*) into v_retry_24h from public.character2_gen_failures
    where kind = 'retry' and created_at >= now() - interval '24 hours';

  select coalesce(jsonb_agg(g order by g_count desc, g_last desc), '[]'::jsonb) into v_rollup
  from (
    select jsonb_build_object('stage', stage, 'errorCode', error_code, 'count', count(*), 'lastSeen', max(created_at)) as g,
           count(*) as g_count, max(created_at) as g_last
    from public.character2_gen_failures
    where kind = 'failure' and created_at >= now() - interval '7 days'
    group by stage, error_code
  ) s;

  -- Retry rollup: which stage + which rule, plus one recent detail to read the specifics.
  select coalesce(jsonb_agg(r order by r_count desc, r_last desc), '[]'::jsonb) into v_retries
  from (
    select jsonb_build_object(
             'stage', stage, 'errorCode', error_code, 'count', count(*),
             'lastSeen', max(created_at),
             'sampleDetail', left(max(error_detail), 400)
           ) as r,
           count(*) as r_count, max(created_at) as r_last
    from public.character2_gen_failures
    where kind = 'retry' and created_at >= now() - interval '7 days'
    group by stage, error_code
  ) rt;

  select coalesce(jsonb_agg(r order by r_at desc), '[]'::jsonb) into v_recent
  from (
    select jsonb_build_object(
             'id', f.id, 'createdAt', f.created_at, 'stage', f.stage, 'shareCode', f.share_code,
             'errorCode', f.error_code, 'errorDetail', f.error_detail,
             'characterName', coalesce(p.passport_json #>> '{basicProfile,name}', c.name),
             'ownerName', c.owner_name
           ) as r, f.created_at as r_at
    from public.character2_gen_failures f
    left join public.character2_characters c on c.share_code = f.share_code
    left join public.character2_passports p on p.character_id = c.id
    where f.kind = 'failure'
    order by f.created_at desc
    limit v_limit
  ) t;

  select coalesce(jsonb_agg(k order by k_at asc), '[]'::jsonb) into v_stuck
  from (
    select jsonb_build_object(
             'id', i.id, 'startedAt', i.started_at, 'stage', i.stage, 'shareCode', i.share_code,
             'minutesStuck', round(extract(epoch from (now() - i.started_at)) / 60)::integer,
             'characterName', coalesce(p.passport_json #>> '{basicProfile,name}', c.name),
             'ownerName', c.owner_name
           ) as k, i.started_at as k_at
    from public.character2_gen_inflight i
    left join public.character2_characters c on c.share_code = i.share_code
    left join public.character2_passports p on p.character_id = c.id
    where i.started_at < now() - interval '6 minutes'
    order by i.started_at asc
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
