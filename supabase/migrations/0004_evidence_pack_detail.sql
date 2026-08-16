-- Evidence Pack v2 detail generation.
-- Public profile text may be re-read verbatim by the paid detail model because it
-- is already public. Secret-profile and owner/interview material remains only in
-- the non-verbatim structured detail seed created during summary generation.

create or replace function public.character2_get_detail_bundle(p_share_code text, p_access_code text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare result jsonb;
begin
  if not public.character2_validate_access_code(p_access_code) then
    raise exception 'CODE_INVALID';
  end if;

  select jsonb_build_object(
    'seed', r.detail_seed_json,
    'detail', r.detail_json,
    'legacyAnalysis', p.passport_json->'analysis',
    'publicProfileText', coalesce(p.passport_json #>> '{basicProfile,profileText}', ''),
    'confirmedFactCount', jsonb_array_length(coalesce(p.passport_json->'confirmedFacts','[]'::jsonb)),
    'inferenceCount', (
      select count(*)
      from jsonb_array_elements(coalesce(p.passport_json->'aiInferences','[]'::jsonb)) item
      where coalesce(item->>'ownerVerdict','') <> 'rejected'
    )
  ) into result
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  left join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
  limit 1;

  return result;
end; $$;

revoke all on function public.character2_get_detail_bundle(text,text) from public;
grant execute on function public.character2_get_detail_bundle(text,text) to anon;
