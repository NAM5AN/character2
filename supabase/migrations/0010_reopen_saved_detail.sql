-- A character becomes entitled to reopen its detail report once any paid-detail generation
-- has been saved. Reopening never depends on the current rotating access code.

create or replace function public.character2_get_saved_detail(p_share_code text)
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
    'stageReady', case
      when coalesce(r.detail_json->>'detailStage','') in ('1','2','3') then (r.detail_json->>'detailStage')::integer
      when length(btrim(coalesce(r.detail_json->>'integratedReport',''))) > 0 then 3
      when length(btrim(coalesce(r.detail_json->>'relationshipStyle',''))) > 0 then 2
      when length(btrim(coalesce(r.detail_json->>'characterOverview',''))) > 0 then 1
      when length(btrim(coalesce(r.detail_json->>'detailedReport',''))) > 0 then 3
      else 1
    end,
    'complete', (
      coalesce(r.detail_json->>'detailComplete','') = 'true'
      or coalesce(r.detail_json->>'detailStage','') = '3'
      or length(btrim(coalesce(r.detail_json->>'integratedReport',''))) > 0
      or length(btrim(coalesce(r.detail_json->>'detailedReport',''))) > 0
    )
  )
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and r.detail_json is not null
  limit 1;
$$;

revoke all on function public.character2_get_saved_detail(text) from public;
grant execute on function public.character2_get_saved_detail(text) to anon;
