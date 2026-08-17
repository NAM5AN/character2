-- Keep late/after-response telemetry attached to the character without touching business tables.

create table if not exists public.character2_ai_usage_sessions (
  usage_session_id uuid primary key,
  character_id uuid not null references public.character2_characters(id) on delete cascade,
  share_code varchar(8) not null,
  attached_at timestamptz not null default now()
);

alter table public.character2_ai_usage_sessions enable row level security;
revoke all on table public.character2_ai_usage_sessions from public, anon, authenticated;

create or replace function public.character2_log_ai_usage(
  p_usage_session_id uuid,
  p_share_code text,
  p_stage text,
  p_model text,
  p_generation_id text,
  p_attempt integer,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint,
  p_cost_usd numeric,
  p_latency_ms integer,
  p_finish_reason text
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_character_id uuid;
  v_share_code text;
begin
  if coalesce(trim(p_stage),'') = '' or length(p_stage) > 100 then return false; end if;
  if coalesce(trim(p_model),'') = '' or length(p_model) > 160 then return false; end if;
  if p_attempt < 1 or p_attempt > 10 then return false; end if;
  if coalesce(p_input_tokens,0) < 0 or coalesce(p_output_tokens,0) < 0 or coalesce(p_total_tokens,0) < 0 then return false; end if;

  v_share_code := nullif(upper(trim(coalesce(p_share_code,''))), '');
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
    usage_session_id, character_id, share_code, stage, model, generation_id,
    attempt, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, finish_reason
  ) values (
    p_usage_session_id, v_character_id, v_share_code, trim(p_stage), trim(p_model), nullif(trim(coalesce(p_generation_id,'')),''),
    p_attempt, coalesce(p_input_tokens,0), coalesce(p_output_tokens,0), coalesce(p_total_tokens,0),
    p_cost_usd, p_latency_ms, nullif(trim(coalesce(p_finish_reason,'')),'')
  )
  on conflict (generation_id) do update set
    character_id = coalesce(public.character2_ai_usage_events.character_id, excluded.character_id),
    share_code = coalesce(public.character2_ai_usage_events.share_code, excluded.share_code),
    input_tokens = greatest(public.character2_ai_usage_events.input_tokens, excluded.input_tokens),
    output_tokens = greatest(public.character2_ai_usage_events.output_tokens, excluded.output_tokens),
    total_tokens = greatest(public.character2_ai_usage_events.total_tokens, excluded.total_tokens),
    cost_usd = coalesce(excluded.cost_usd, public.character2_ai_usage_events.cost_usd),
    latency_ms = coalesce(excluded.latency_ms, public.character2_ai_usage_events.latency_ms),
    finish_reason = coalesce(excluded.finish_reason, public.character2_ai_usage_events.finish_reason);

  return true;
end; $$;

create or replace function public.character2_attach_ai_usage_session(
  p_usage_session_id uuid,
  p_share_code text
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_character_id uuid;
  v_share_code text;
begin
  if p_usage_session_id is null then return false; end if;
  v_share_code := upper(trim(coalesce(p_share_code,'')));
  select c.id into v_character_id
  from public.character2_characters c
  where c.share_code = v_share_code
  limit 1;
  if v_character_id is null then return false; end if;

  insert into public.character2_ai_usage_sessions(usage_session_id,character_id,share_code)
  values(p_usage_session_id,v_character_id,v_share_code)
  on conflict (usage_session_id) do update set
    character_id=excluded.character_id,
    share_code=excluded.share_code,
    attached_at=now();

  update public.character2_ai_usage_events
  set character_id = v_character_id,
      share_code = v_share_code
  where usage_session_id = p_usage_session_id
    and character_id is null;

  return true;
end; $$;

revoke all on function public.character2_log_ai_usage(uuid,text,text,text,text,integer,bigint,bigint,bigint,numeric,integer,text) from public;
revoke all on function public.character2_attach_ai_usage_session(uuid,text) from public;
grant execute on function public.character2_log_ai_usage(uuid,text,text,text,text,integer,bigint,bigint,bigint,numeric,integer,text) to anon;
grant execute on function public.character2_attach_ai_usage_session(uuid,text) to anon;
