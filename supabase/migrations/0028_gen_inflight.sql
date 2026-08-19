-- In-flight heartbeat so the admin console can see hard failures that leave no
-- catchable trace — chiefly 300s function timeouts, but also OOM / process kills.
-- When a generation is force-terminated, our catch/finally never runs, so
-- character2_gen_failures gets no row. Instead we record a row at the START of each
-- AI stage and delete it on completion (success OR caught error). A row that lingers
-- past the max possible runtime (300s cap → we use a 6-minute floor) means the process
-- died without finishing: a timeout/crash.
--
-- Driven from withAiUsageContext (server), which wraps every AI stage:
--   begin -> work() -> (log failure on throw) -> end (in finally)

create table if not exists public.character2_gen_inflight (
  id uuid primary key,
  started_at timestamptz not null default now(),
  stage text not null,
  share_code text,
  session_id uuid
);

create index if not exists character2_gen_inflight_started_idx
  on public.character2_gen_inflight (started_at);

alter table public.character2_gen_inflight enable row level security;

-- Mark a stage as started. Also prunes rows older than 7 days (long-dead, no longer
-- worth surfacing) so the table cannot grow unbounded if an end() is ever missed.
create or replace function public.character2_gen_inflight_begin(
  p_id uuid,
  p_stage text,
  p_share_code text,
  p_session_id uuid
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  insert into public.character2_gen_inflight(id, stage, share_code, session_id)
  values (
    p_id,
    left(coalesce(nullif(trim(p_stage), ''), 'unknown'), 80),
    nullif(upper(trim(coalesce(p_share_code, ''))), ''),
    p_session_id
  )
  on conflict (id) do nothing;
  delete from public.character2_gen_inflight where started_at < now() - interval '7 days';
end; $$;

-- Mark a stage as finished (success or caught failure). Best-effort.
create or replace function public.character2_gen_inflight_end(p_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.character2_gen_inflight where id = p_id;
end; $$;

revoke all on function public.character2_gen_inflight_begin(uuid,text,text,uuid) from public;
revoke all on function public.character2_gen_inflight_end(uuid) from public;
grant execute on function public.character2_gen_inflight_begin(uuid,text,text,uuid) to anon;
grant execute on function public.character2_gen_inflight_end(uuid) to anon;

-- Extend the admin reader to also return "stuck" in-flight rows (started but never
-- finished, older than the 6-minute floor = confirmed process death / timeout).
create or replace function public.character2_admin_gen_failures(p_token text, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_rollup jsonb;
  v_recent jsonb;
  v_stuck jsonb;
  v_total_24h integer;
  v_total_7d integer;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  select count(*) into v_total_24h from public.character2_gen_failures where created_at >= now() - interval '24 hours';
  select count(*) into v_total_7d  from public.character2_gen_failures where created_at >= now() - interval '7 days';

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

  -- Confirmed process deaths: in-flight rows older than 6 minutes (> the 300s cap).
  select coalesce(jsonb_agg(k order by k_at asc), '[]'::jsonb) into v_stuck
  from (
    select
      jsonb_build_object(
        'id', i.id,
        'startedAt', i.started_at,
        'stage', i.stage,
        'shareCode', i.share_code,
        'minutesStuck', round(extract(epoch from (now() - i.started_at)) / 60)::integer,
        'characterName', coalesce(p.passport_json #>> '{basicProfile,name}', c.name),
        'ownerName', c.owner_name
      ) as k,
      i.started_at as k_at
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
    'stuck', v_stuck
  );
end; $$;
