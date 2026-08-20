-- Track every model call as one immutable attempt so retries and their spend can be
-- attributed without guessing from timestamps. Older usage rows remain valid but do
-- not pretend to have attempt-level accuracy.

alter table public.character2_ai_usage_events
  add column if not exists attempt_id uuid,
  add column if not exists operation_id uuid,
  add column if not exists operation_sequence integer,
  add column if not exists attempt_outcome text not null default 'accepted',
  add column if not exists error_code text,
  add column if not exists error_detail text,
  add column if not exists has_usage boolean not null default true,
  add column if not exists character_name text;

create unique index if not exists character2_ai_usage_attempt_id_idx
  on public.character2_ai_usage_events(attempt_id);
create index if not exists character2_ai_usage_operation_idx
  on public.character2_ai_usage_events(operation_id, operation_sequence);
create index if not exists character2_ai_usage_outcome_idx
  on public.character2_ai_usage_events(share_code, attempt_outcome, created_at desc);

alter table public.character2_gen_failures
  add column if not exists operation_id uuid,
  add column if not exists attempt_id uuid,
  add column if not exists model text;

create index if not exists character2_gen_failures_operation_idx
  on public.character2_gen_failures(operation_id, created_at desc);
create index if not exists character2_gen_failures_attempt_idx
  on public.character2_gen_failures(attempt_id, created_at desc);

-- Terminal operation failures must outlive the 30-day troubleshooting log; otherwise
-- an old loss would silently disappear from a character's lifetime cost total.
create table if not exists public.character2_ai_failed_operations (
  operation_id uuid primary key,
  failed_at timestamptz not null default now(),
  usage_session_id uuid,
  share_code text,
  character_name text,
  stage text not null,
  error_code text not null,
  error_detail text
);

alter table public.character2_ai_failed_operations enable row level security;
revoke all on table public.character2_ai_failed_operations from public, anon, authenticated;

create or replace function public.character2_log_ai_attempt(
  p_attempt_id uuid,
  p_operation_id uuid,
  p_operation_sequence integer,
  p_usage_session_id uuid,
  p_share_code text,
  p_character_name text,
  p_stage text,
  p_model text,
  p_generation_id text,
  p_local_attempt integer,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint,
  p_cost_usd numeric,
  p_latency_ms integer,
  p_finish_reason text,
  p_outcome text,
  p_error_code text,
  p_error_detail text,
  p_has_usage boolean,
  p_telemetry_secret text
)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_character_id uuid;
  v_share_code text;
  v_outcome text;
begin
  if encode(extensions.digest(coalesce(p_telemetry_secret, ''), 'sha256'), 'hex')
    <> '669ef73537cd1dfe38d030b58fdfa22534d80c55b47d36fe0e0d4f3042ae8c78' then
    raise exception 'TELEMETRY_AUTH_INVALID';
  end if;

  if p_attempt_id is null or p_operation_id is null then return false; end if;
  if coalesce(trim(p_stage), '') = '' or length(p_stage) > 100 then return false; end if;
  if coalesce(trim(p_model), '') = '' or length(p_model) > 160 then return false; end if;
  if p_local_attempt < 1 or p_local_attempt > 10 then return false; end if;
  if p_operation_sequence < 1 or p_operation_sequence > 100 then return false; end if;
  if coalesce(p_input_tokens, 0) < 0
    or coalesce(p_output_tokens, 0) < 0
    or coalesce(p_total_tokens, 0) < 0 then return false;
  end if;

  v_outcome := case lower(coalesce(p_outcome, 'failed'))
    when 'accepted' then 'accepted'
    when 'retried' then 'retried'
    else 'failed'
  end;
  v_share_code := nullif(upper(trim(coalesce(p_share_code, ''))), '');

  if v_share_code is not null then
    select c.id into v_character_id
    from public.character2_characters c
    where c.share_code = v_share_code
    limit 1;
  end if;

  if v_character_id is null and p_usage_session_id is not null then
    select s.character_id, s.share_code into v_character_id, v_share_code
    from public.character2_ai_usage_sessions s
    where s.usage_session_id = p_usage_session_id
    limit 1;
  end if;

  insert into public.character2_ai_usage_events(
    usage_session_id,
    character_id,
    share_code,
    character_name,
    stage,
    model,
    generation_id,
    attempt,
    attempt_id,
    operation_id,
    operation_sequence,
    attempt_outcome,
    error_code,
    error_detail,
    has_usage,
    input_tokens,
    output_tokens,
    total_tokens,
    cost_usd,
    latency_ms,
    finish_reason
  ) values (
    p_usage_session_id,
    v_character_id,
    v_share_code,
    left(nullif(trim(coalesce(p_character_name, '')), ''), 80),
    trim(p_stage),
    trim(p_model),
    nullif(trim(coalesce(p_generation_id, '')), ''),
    p_local_attempt,
    p_attempt_id,
    p_operation_id,
    p_operation_sequence,
    v_outcome,
    left(nullif(trim(coalesce(p_error_code, '')), ''), 80),
    left(nullif(trim(coalesce(p_error_detail, '')), ''), 2000),
    coalesce(p_has_usage, false),
    coalesce(p_input_tokens, 0),
    coalesce(p_output_tokens, 0),
    coalesce(p_total_tokens, 0),
    p_cost_usd,
    p_latency_ms,
    left(nullif(trim(coalesce(p_finish_reason, '')), ''), 80)
  )
  on conflict (attempt_id) do update set
    usage_session_id = coalesce(public.character2_ai_usage_events.usage_session_id, excluded.usage_session_id),
    character_id = coalesce(public.character2_ai_usage_events.character_id, excluded.character_id),
    share_code = coalesce(public.character2_ai_usage_events.share_code, excluded.share_code),
    character_name = coalesce(public.character2_ai_usage_events.character_name, excluded.character_name),
    generation_id = coalesce(excluded.generation_id, public.character2_ai_usage_events.generation_id),
    attempt_outcome = case
      when public.character2_ai_usage_events.attempt_outcome = 'retried' or excluded.attempt_outcome = 'retried' then 'retried'
      when public.character2_ai_usage_events.attempt_outcome = 'failed' or excluded.attempt_outcome = 'failed' then 'failed'
      else 'accepted'
    end,
    error_code = coalesce(excluded.error_code, public.character2_ai_usage_events.error_code),
    error_detail = coalesce(excluded.error_detail, public.character2_ai_usage_events.error_detail),
    has_usage = public.character2_ai_usage_events.has_usage or excluded.has_usage,
    input_tokens = greatest(public.character2_ai_usage_events.input_tokens, excluded.input_tokens),
    output_tokens = greatest(public.character2_ai_usage_events.output_tokens, excluded.output_tokens),
    total_tokens = greatest(public.character2_ai_usage_events.total_tokens, excluded.total_tokens),
    cost_usd = coalesce(excluded.cost_usd, public.character2_ai_usage_events.cost_usd),
    latency_ms = coalesce(excluded.latency_ms, public.character2_ai_usage_events.latency_ms),
    finish_reason = coalesce(excluded.finish_reason, public.character2_ai_usage_events.finish_reason);

  return true;
end; $$;

revoke all on function public.character2_log_ai_attempt(uuid,uuid,integer,uuid,text,text,text,text,text,integer,bigint,bigint,bigint,numeric,integer,text,text,text,text,boolean,text) from public, authenticated;
grant execute on function public.character2_log_ai_attempt(uuid,uuid,integer,uuid,text,text,text,text,text,integer,bigint,bigint,bigint,numeric,integer,text,text,text,text,boolean,text) to anon;

-- New overload: terminal failures and retry reasons carry the same operation/attempt
-- identifiers as usage. The previous overload remains available during deployment.
create or replace function public.character2_log_gen_failure(
  p_stage text,
  p_share_code text,
  p_session_id uuid,
  p_error_code text,
  p_error_detail text,
  p_kind text,
  p_character_name text,
  p_operation_id uuid,
  p_attempt_id uuid,
  p_model text,
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
    character_name,
    operation_id,
    attempt_id,
    model
  ) values (
    left(coalesce(nullif(trim(p_stage), ''), 'unknown'), 80),
    nullif(upper(trim(coalesce(p_share_code, ''))), ''),
    p_session_id,
    left(coalesce(nullif(trim(p_error_code), ''), 'SERVER_ERROR'), 80),
    left(nullif(trim(coalesce(p_error_detail, '')), ''), 2000),
    case when lower(coalesce(p_kind, 'failure')) = 'retry' then 'retry' else 'failure' end,
    left(nullif(trim(coalesce(p_character_name, '')), ''), 80),
    p_operation_id,
    p_attempt_id,
    left(nullif(trim(coalesce(p_model, '')), ''), 160)
  );

  if p_operation_id is not null and lower(coalesce(p_kind, 'failure')) <> 'retry' then
    insert into public.character2_ai_failed_operations(
      operation_id,
      usage_session_id,
      share_code,
      character_name,
      stage,
      error_code,
      error_detail
    ) values (
      p_operation_id,
      p_session_id,
      nullif(upper(trim(coalesce(p_share_code, ''))), ''),
      left(nullif(trim(coalesce(p_character_name, '')), ''), 80),
      left(coalesce(nullif(trim(p_stage), ''), 'unknown'), 80),
      left(coalesce(nullif(trim(p_error_code), ''), 'SERVER_ERROR'), 80),
      left(nullif(trim(coalesce(p_error_detail, '')), ''), 2000)
    )
    on conflict (operation_id) do update set
      failed_at = excluded.failed_at,
      usage_session_id = coalesce(public.character2_ai_failed_operations.usage_session_id, excluded.usage_session_id),
      share_code = coalesce(public.character2_ai_failed_operations.share_code, excluded.share_code),
      character_name = coalesce(public.character2_ai_failed_operations.character_name, excluded.character_name),
      error_code = excluded.error_code,
      error_detail = coalesce(excluded.error_detail, public.character2_ai_failed_operations.error_detail);
  end if;

  delete from public.character2_gen_failures
  where created_at < now() - interval '30 days';
end; $$;

revoke all on function public.character2_log_gen_failure(text,text,uuid,text,text,text,text,uuid,uuid,text,text) from public, authenticated;
grant execute on function public.character2_log_gen_failure(text,text,uuid,text,text,text,text,uuid,uuid,text,text) to anon;

create or replace function public.character2_attach_ai_usage_session(
  p_usage_session_id uuid,
  p_share_code text,
  p_telemetry_secret text
)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_character_id uuid;
  v_share_code text;
begin
  if encode(extensions.digest(coalesce(p_telemetry_secret, ''), 'sha256'), 'hex')
    <> '669ef73537cd1dfe38d030b58fdfa22534d80c55b47d36fe0e0d4f3042ae8c78' then
    raise exception 'TELEMETRY_AUTH_INVALID';
  end if;
  if p_usage_session_id is null then return false; end if;

  v_share_code := upper(trim(coalesce(p_share_code, '')));
  select c.id into v_character_id
  from public.character2_characters c
  where c.share_code = v_share_code
  limit 1;
  if v_character_id is null then return false; end if;

  insert into public.character2_ai_usage_sessions(usage_session_id, character_id, share_code)
  values (p_usage_session_id, v_character_id, v_share_code)
  on conflict (usage_session_id) do update set
    character_id = excluded.character_id,
    share_code = excluded.share_code,
    attached_at = now();

  update public.character2_ai_usage_events
  set character_id = v_character_id,
      share_code = v_share_code
  where usage_session_id = p_usage_session_id
    and character_id is null;

  return true;
end; $$;

revoke all on function public.character2_attach_ai_usage_session(uuid,text,text) from public, authenticated;
grant execute on function public.character2_attach_ai_usage_session(uuid,text,text) to anon;

-- Keep the existing total-cost fields and add the subset lost to discarded retries
-- or a terminally failed operation. OpenAI is estimated from tokens in the client;
-- other gateway models use their exact cost_usd when available.
create or replace function public.character2_admin_cost_rollups(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare result jsonb;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shareCode', c.share_code,
    'summaryCostUsd', coalesce(u.summary_cost_usd, 0),
    'detailCostUsd', coalesce(u.detail_cost_usd, 0),
    'summaryGptInTok', coalesce(u.summary_gpt_in_tok, 0),
    'summaryGptOutTok', coalesce(u.summary_gpt_out_tok, 0),
    'detailGptInTok', coalesce(u.detail_gpt_in_tok, 0),
    'detailGptOutTok', coalesce(u.detail_gpt_out_tok, 0),
    'usageUpdatedAt', u.usage_updated_at,
    'wastedCostUsd', coalesce(u.wasted_cost_usd, 0),
    'wastedGptInTok', coalesce(u.wasted_gpt_in_tok, 0),
    'wastedGptOutTok', coalesce(u.wasted_gpt_out_tok, 0),
    'wastedAttemptCount', coalesce(u.wasted_attempt_count, 0) + coalesce(legacy.unknown_count, 0),
    'wastedUnknownCount', coalesce(u.wasted_unknown_count, 0) + coalesce(legacy.unknown_count, 0),
    'retryCount', coalesce(retry.retry_count, 0),
    'retryDetails', coalesce(retry.details, '[]'::jsonb)
  ) order by c.created_at desc), '[]'::jsonb)
  into result
  from public.character2_characters c
  left join lateral (
    with classified as (
      select e.*,
        (
          e.attempt_outcome in ('retried', 'failed')
          or exists (
            select 1 from public.character2_gen_failures rf
            where rf.kind = 'retry' and rf.attempt_id = e.attempt_id
          )
          or exists (
            select 1 from public.character2_ai_failed_operations ff
            where ff.operation_id = e.operation_id
          )
        ) as wasted
      from public.character2_ai_usage_events e
      where e.share_code = c.share_code
    )
    select
      round(coalesce(sum(case
        when e.stage not like 'detail%' and e.model not like 'openai/%'
        then coalesce(e.cost_usd, 0) else 0 end
      ), 0)::numeric, 6) as summary_cost_usd,
      round(coalesce(sum(case
        when e.stage like 'detail%' and e.model not like 'openai/%'
        then coalesce(e.cost_usd, 0) else 0 end
      ), 0)::numeric, 6) as detail_cost_usd,
      coalesce(sum(case
        when e.model like 'openai/%' and e.stage not like 'detail%'
        then e.input_tokens else 0 end
      ), 0)::bigint as summary_gpt_in_tok,
      coalesce(sum(case
        when e.model like 'openai/%' and e.stage not like 'detail%'
        then e.output_tokens else 0 end
      ), 0)::bigint as summary_gpt_out_tok,
      coalesce(sum(case
        when e.model like 'openai/%' and e.stage like 'detail%'
        then e.input_tokens else 0 end
      ), 0)::bigint as detail_gpt_in_tok,
      coalesce(sum(case
        when e.model like 'openai/%' and e.stage like 'detail%'
        then e.output_tokens else 0 end
      ), 0)::bigint as detail_gpt_out_tok,
      max(e.created_at) as usage_updated_at,
      round(coalesce(sum(case
        when e.wasted and e.model not like 'openai/%'
        then coalesce(e.cost_usd, 0) else 0 end
      ), 0)::numeric, 6) as wasted_cost_usd,
      coalesce(sum(case when e.wasted and e.model like 'openai/%' then e.input_tokens else 0 end), 0)::bigint as wasted_gpt_in_tok,
      coalesce(sum(case when e.wasted and e.model like 'openai/%' then e.output_tokens else 0 end), 0)::bigint as wasted_gpt_out_tok,
      count(*) filter (where e.wasted)::integer as wasted_attempt_count,
      count(*) filter (
        where e.wasted and (
          not e.has_usage
          or (e.model like 'openai/%' and e.total_tokens = 0)
          or (e.model not like 'openai/%' and e.cost_usd is null)
        )
      )::integer as wasted_unknown_count
    from classified e
  ) u on true
  left join lateral (
    select count(*)::integer as unknown_count
    from public.character2_gen_failures f
    left join public.character2_ai_usage_sessions us on us.usage_session_id = f.session_id
    where f.kind in ('retry', 'failure')
      and coalesce(f.share_code, us.share_code) = c.share_code
      and not exists (
        select 1 from public.character2_ai_usage_events missing
        where missing.attempt_id = f.attempt_id
      )
  ) legacy on true
  left join lateral (
    select
      count(*)::integer as retry_count,
      coalesce(jsonb_agg(d.item order by d.created_at desc), '[]'::jsonb) as details
    from (
      select
        e.created_at,
        jsonb_build_object(
          'id', e.attempt_id,
          'createdAt', e.created_at,
          'stage', e.stage,
          'model', e.model,
          'attemptSequence', e.operation_sequence,
          'errorCode', coalesce(rf.error_code, e.error_code, 'RETRY_UNKNOWN'),
          'errorDetail', coalesce(rf.error_detail, e.error_detail),
          'costUsd', case when e.model not like 'openai/%' then e.cost_usd else null end,
          'gptInTok', case when e.model like 'openai/%' then e.input_tokens else 0 end,
          'gptOutTok', case when e.model like 'openai/%' then e.output_tokens else 0 end,
          'costKnown', case
            when not e.has_usage then false
            when e.model like 'openai/%' then e.total_tokens > 0
            else e.cost_usd is not null
          end,
          'costSource', case
            when not e.has_usage then 'unavailable'
            when e.model like 'openai/%' and e.total_tokens > 0 then 'token_estimate'
            when e.model not like 'openai/%' and e.cost_usd is not null then 'gateway_exact'
            else 'unavailable'
          end
        ) as item
      from public.character2_ai_usage_events e
      left join lateral (
        select f.error_code, f.error_detail
        from public.character2_gen_failures f
        where f.kind = 'retry' and f.attempt_id = e.attempt_id
        order by f.created_at desc
        limit 1
      ) rf on true
      where e.share_code = c.share_code
        and (e.attempt_outcome = 'retried' or rf.error_code is not null)

      union all

      select
        f.created_at,
        jsonb_build_object(
          'id', 'legacy-' || f.id::text,
          'createdAt', f.created_at,
          'stage', f.stage,
          'model', f.model,
          'attemptSequence', null,
          'errorCode', f.error_code,
          'errorDetail', f.error_detail,
          'costUsd', null,
          'gptInTok', 0,
          'gptOutTok', 0,
          'costKnown', false,
          'costSource', 'unavailable'
        ) as item
      from public.character2_gen_failures f
      left join public.character2_ai_usage_sessions us on us.usage_session_id = f.session_id
      where f.kind = 'retry'
        and coalesce(f.share_code, us.share_code) = c.share_code
        and not exists (
          select 1 from public.character2_ai_usage_events missing
          where missing.attempt_id = f.attempt_id
        )
    ) d
  ) retry on true;

  return result;
end; $$;

revoke all on function public.character2_admin_cost_rollups(text) from public, authenticated;
grant execute on function public.character2_admin_cost_rollups(text) to anon;
