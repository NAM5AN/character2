-- 미리보기 응답에 요약 카드 전용 한 문장(analysis.summaryCardLines)을 추가한다.
-- 기존 키는 그대로 두고 summaryCardLines만 더하는 하위호환 변경.
create or replace function public.character2_get_public_preview(p_share_code text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'name', coalesce(p.passport_json #>> '{basicProfile,name}', c.name),
    'ownerName', c.owner_name,
    'shareCode', c.share_code,
    'oneLineSummary', coalesce(p.passport_json #>> '{analysis,oneLineSummary}', ''),
    'summary', case
      when jsonb_typeof(p.passport_json #> '{analysis,summary}') = 'object'
        then p.passport_json #> '{analysis,summary}'
      else jsonb_build_object(
        'outerSelf', left(coalesce(p.passport_json #>> '{analysis,outerSelf}', ''), 160),
        'innerSelf', left(coalesce(p.passport_json #>> '{analysis,innerSelf}', ''), 160),
        'conflictStyle', left(coalesce(p.passport_json #>> '{analysis,conflictStyle}', ''), 160),
        'affectionStyle', left(coalesce(p.passport_json #>> '{analysis,affectionStyle}', ''), 160)
      )
    end,
    'summaryTags', case
      when jsonb_typeof(p.passport_json #> '{analysis,summaryTags}') = 'object'
        then p.passport_json #> '{analysis,summaryTags}'
      else null
    end,
    'summaryCardLines', case
      when jsonb_typeof(p.passport_json #> '{analysis,summaryCardLines}') = 'object'
        then p.passport_json #> '{analysis,summaryCardLines}'
      else null
    end
  )
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
  limit 1;
$$;

grant execute on function public.character2_get_public_preview(text) to anon;
