-- Reopen a character's already-completed detail report without requiring the current paid code.
-- This does not generate or unlock a new report: unpaid/incomplete characters still return null
-- and continue through the normal summary + purchase flow.

create or replace function public.character2_get_completed_detail(p_share_code text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'analysis', r.detail_json,
    'confirmedFactCount', jsonb_array_length(coalesce(p.passport_json->'confirmedFacts','[]'::jsonb)),
    'inferenceCount', (
      select count(*)
      from jsonb_array_elements(coalesce(p.passport_json->'aiInferences','[]'::jsonb)) item
      where coalesce(item->>'ownerVerdict','') <> 'rejected'
    ),
    'cached', true,
    'stageReady', 3,
    'complete', true
  )
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and r.detail_json is not null
    and (
      coalesce(r.detail_json->>'detailComplete','') = 'true'
      or coalesce(r.detail_json->>'detailStage','') = '3'
      or length(btrim(coalesce(r.detail_json->>'integratedReport',''))) > 0
      or length(btrim(coalesce(r.detail_json->>'detailedReport',''))) > 0
    )
  limit 1;
$$;

revoke all on function public.character2_get_completed_detail(text) from public;
grant execute on function public.character2_get_completed_detail(text) to anon;
