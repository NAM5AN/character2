-- Previously generated paid detail reports are intentionally replayable without
-- the current rotating access code. This RPC is read-only and exposes only the
-- saved user-facing analysis; private source_json and _detailDossier stay hidden.

create or replace function public.character2_get_saved_detail_public(p_share_code text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'analysis', r.detail_json - '_detailDossier',
    'confirmedFactCount', jsonb_array_length(coalesce(p.passport_json->'confirmedFacts','[]'::jsonb)),
    'inferenceCount', (
      select count(*)
      from jsonb_array_elements(coalesce(p.passport_json->'aiInferences','[]'::jsonb)) item
      where coalesce(item->>'ownerVerdict','') <> 'rejected'
    ),
    'stageReady', case
      when coalesce(r.detail_json->>'detailStage','') in ('1','2','3')
        then (r.detail_json->>'detailStage')::integer
      when length(btrim(coalesce(r.detail_json->>'integratedReport',''))) > 0 then 3
      when length(btrim(coalesce(r.detail_json->>'detailedReport',''))) > 0 then 3
      when length(btrim(coalesce(r.detail_json->>'relationshipStyle',''))) > 0 then 2
      when length(btrim(coalesce(r.detail_json->>'characterOverview',''))) > 0 then 1
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
    and jsonb_typeof(r.detail_json) = 'object'
  limit 1;
$$;

revoke all on function public.character2_get_saved_detail_public(text) from public;
grant execute on function public.character2_get_saved_detail_public(text) to anon;
