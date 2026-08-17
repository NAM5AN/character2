-- Once a detail report has been generated at least once, the character is treated as
-- entitled to reopen it regardless of later access-code rotation. These RPCs only operate
-- on rows that already have detail_json, so an unpaid character cannot be unlocked by them.

create or replace function public.character2_get_saved_detail_bundle(p_share_code text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'seed', r.detail_seed_json,
    'detail', r.detail_json,
    'publicProfileText', coalesce(p.passport_json #>> '{basicProfile,profileText}', ''),
    'confirmedFactCount', jsonb_array_length(coalesce(p.passport_json->'confirmedFacts','[]'::jsonb)),
    'inferenceCount', (
      select count(*)
      from jsonb_array_elements(coalesce(p.passport_json->'aiInferences','[]'::jsonb)) item
      where coalesce(item->>'ownerVerdict','') <> 'rejected'
    )
  )
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and r.detail_json is not null
  limit 1;
$$;

create or replace function public.character2_save_saved_detail(p_share_code text, p_detail_json jsonb)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_character_id uuid;
begin
  select c.id into v_character_id
  from public.character2_characters c
  join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and r.detail_json is not null
  limit 1;

  if v_character_id is null then return false; end if;

  update public.character2_private_reports
  set detail_json = p_detail_json,
      detail_generated_at = now(),
      updated_at = now()
  where character_id = v_character_id
    and detail_json is not null;

  return found;
end; $$;

revoke all on function public.character2_get_saved_detail_bundle(text) from public;
revoke all on function public.character2_save_saved_detail(text,jsonb) from public;
grant execute on function public.character2_get_saved_detail_bundle(text) to anon;
grant execute on function public.character2_save_saved_detail(text,jsonb) to anon;
