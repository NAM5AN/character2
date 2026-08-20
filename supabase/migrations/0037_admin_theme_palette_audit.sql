-- Expose the persisted UI theme palette to authenticated admin tooling.
create or replace function public.character2_admin_list(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to public, extensions
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
        'themePalette', case
          when jsonb_typeof(p.passport_json -> 'themePalette') = 'object'
            then p.passport_json -> 'themePalette'
          else null
        end,
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
end;
$$;

revoke all on function public.character2_admin_list(text) from public;
grant execute on function public.character2_admin_list(text) to anon;
