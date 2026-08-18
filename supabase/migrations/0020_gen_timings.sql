-- Per-character generation wall-clock timings for the admin console.
-- The AI usage telemetry cannot reconstruct this: latency_ms is mostly null/0 and
-- created_at is batched at request end (all calls in one request share a timestamp).
-- So we measure elapsed time explicitly at generation and store it here.
--   summary_ms      : how long the summary report generation took (finalize request).
--   detail_started_at + detail_ms : detail report wall-clock measured from CODE INPUT
--     (stage 1 start) to the last page done. Precompute happens before code input and
--     is therefore excluded by construction.

create table if not exists public.character2_gen_timings (
  character_id uuid primary key references public.character2_characters(id) on delete cascade,
  summary_ms integer,
  detail_started_at timestamptz,
  detail_ms integer,
  updated_at timestamptz not null default now()
);

-- Summary generation elapsed (ms). Clamped to a sane range.
create or replace function public.character2_set_summary_timing(p_share_code text, p_ms integer)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  select id into v_id from public.character2_characters where share_code = upper(trim(p_share_code)) limit 1;
  if v_id is null then return; end if;
  if p_ms is null or p_ms < 0 or p_ms > 3600000 then return; end if;
  insert into public.character2_gen_timings(character_id, summary_ms)
  values (v_id, p_ms)
  on conflict (character_id) do update set summary_ms = excluded.summary_ms, updated_at = now();
end; $$;

-- Mark the start of a fresh detail generation (called at stage 1 start, i.e. right after code input).
create or replace function public.character2_mark_detail_timing_start(p_share_code text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  select id into v_id from public.character2_characters where share_code = upper(trim(p_share_code)) limit 1;
  if v_id is null then return; end if;
  insert into public.character2_gen_timings(character_id, detail_started_at)
  values (v_id, now())
  on conflict (character_id) do update set detail_started_at = now(), updated_at = now();
end; $$;

-- Record detail wall-clock as (now - detail_started_at). Guarded so a stale start
-- (e.g. a resume days later) does not produce an absurd number.
create or replace function public.character2_mark_detail_timing_done(p_share_code text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid; v_started timestamptz;
begin
  select id into v_id from public.character2_characters where share_code = upper(trim(p_share_code)) limit 1;
  if v_id is null then return; end if;
  select detail_started_at into v_started from public.character2_gen_timings where character_id = v_id;
  if v_started is null or now() - v_started >= interval '1 hour' then return; end if;
  update public.character2_gen_timings
  set detail_ms = round(extract(epoch from (now() - v_started)) * 1000)::integer,
      updated_at = now()
  where character_id = v_id;
end; $$;

revoke all on function public.character2_set_summary_timing(text,integer) from public;
revoke all on function public.character2_mark_detail_timing_start(text) from public;
revoke all on function public.character2_mark_detail_timing_done(text) from public;
grant execute on function public.character2_set_summary_timing(text,integer) to anon;
grant execute on function public.character2_mark_detail_timing_start(text) to anon;
grant execute on function public.character2_mark_detail_timing_done(text) to anon;

-- admin_list now also returns the two generation timings.
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
        'detailGeneratedAt', r.detail_generated_at,
        'summaryCostUsd', (
          select round(coalesce(sum(e.cost_usd), 0)::numeric, 6)
          from public.character2_ai_usage_events e
          where e.share_code = c.share_code and e.stage like 'summary%'
        ),
        'detailCostUsd', (
          select round(coalesce(sum(e.cost_usd), 0)::numeric, 6)
          from public.character2_ai_usage_events e
          where e.share_code = c.share_code and e.stage like 'detail%'
        ),
        'summaryGptInTok', (
          select coalesce(sum(e.input_tokens), 0)
          from public.character2_ai_usage_events e
          where e.share_code = c.share_code and e.model like 'openai/%'
            and (e.stage like 'profile%' or e.stage like 'questions%' or e.stage like 'summary%')
        ),
        'summaryGptOutTok', (
          select coalesce(sum(e.output_tokens), 0)
          from public.character2_ai_usage_events e
          where e.share_code = c.share_code and e.model like 'openai/%'
            and (e.stage like 'profile%' or e.stage like 'questions%' or e.stage like 'summary%')
        ),
        'detailGptInTok', (
          select coalesce(sum(e.input_tokens), 0)
          from public.character2_ai_usage_events e
          where e.share_code = c.share_code and e.model like 'openai/%' and e.stage like 'detail%'
        ),
        'detailGptOutTok', (
          select coalesce(sum(e.output_tokens), 0)
          from public.character2_ai_usage_events e
          where e.share_code = c.share_code and e.model like 'openai/%' and e.stage like 'detail%'
        ),
        'summaryGenMs', (select t.summary_ms from public.character2_gen_timings t where t.character_id = c.id),
        'detailGenMs', (select t.detail_ms from public.character2_gen_timings t where t.character_id = c.id)
      ) as row_data
    from public.character2_characters c
    left join public.character2_passports p on p.character_id = c.id
    left join public.character2_private_reports r on r.character_id = c.id
  ) t;

  return result;
end; $$;
