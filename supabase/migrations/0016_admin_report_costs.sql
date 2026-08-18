-- Admin console: expose per-character report generation cost (from AI usage
-- telemetry). Costs are the total actually spent generating that character's
-- reports (all attempts included), grouped by summary vs detail stages.
-- Only Anthropic calls carry cost_usd from the gateway; OpenAI (parse/questions)
-- is not priced by the gateway and stays null, so it is not summed here.

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
        )
      ) as row_data
    from public.character2_characters c
    left join public.character2_passports p on p.character_id = c.id
    left join public.character2_private_reports r on r.character_id = c.id
  ) t;

  return result;
end; $$;
