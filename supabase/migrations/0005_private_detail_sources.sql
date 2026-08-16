-- Private raw sources for high-fidelity paid detail generation.
-- These sources are never returned by public preview/detail RPCs. The only RPC
-- that returns source_json requires BOTH the current paid access code and the
-- creator edit token for that character.

alter table public.character2_private_reports
  add column if not exists source_json jsonb not null default '{}'::jsonb;

create or replace function public.character2_create_character_preview_v2(
  p_character_id uuid, p_share_code text, p_name text, p_schema_version text,
  p_passport_json jsonb, p_analysis_confidence numeric, p_engine_versions jsonb,
  p_answers jsonb, p_edit_token_hash text, p_detail_seed_json jsonb, p_source_json jsonb
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare item jsonb;
begin
  if upper(trim(p_share_code)) !~ '^[A-HJ-NP-Z2-9]{8}$' then raise exception 'INVALID_SHARE_CODE'; end if;

  insert into public.character2_characters(id,share_code,name,status,schema_version)
  values(p_character_id,upper(trim(p_share_code)),p_name,'ready',p_schema_version);

  insert into public.character2_passports(character_id,passport_json,analysis_confidence,engine_versions)
  values(p_character_id,p_passport_json,p_analysis_confidence,coalesce(p_engine_versions,'{}'::jsonb));

  for item in select * from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) loop
    insert into public.character2_answers(character_id,question_order,question_text,answer_json,branch_context,question_engine_version)
    values(
      p_character_id,
      (item->>'order')::integer,
      item->>'question',
      jsonb_strip_nulls(jsonb_build_object('answer',item->>'answer','reason',item->>'reason')),
      coalesce(item->'branchContext','{}'::jsonb),
      'interview/1.4'
    );
  end loop;

  insert into public.character2_access(character_id,edit_token_hash)
  values(p_character_id,p_edit_token_hash);

  insert into public.character2_private_reports(character_id,detail_seed_json,source_json)
  values(p_character_id,coalesce(p_detail_seed_json,'{}'::jsonb),coalesce(p_source_json,'{}'::jsonb));

  return true;
end; $$;

create or replace function public.character2_get_detail_source(
  p_share_code text, p_access_code text, p_edit_token text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare result jsonb;
begin
  if not public.character2_validate_access_code(p_access_code) then
    raise exception 'CODE_INVALID';
  end if;

  select r.source_json into result
  from public.character2_characters c
  join public.character2_access a on a.character_id = c.id
  join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and a.edit_token_hash = encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex')
  limit 1;

  return result;
end; $$;

revoke all on function public.character2_create_character_preview_v2(uuid,text,text,text,jsonb,numeric,jsonb,jsonb,text,jsonb,jsonb) from public;
revoke all on function public.character2_get_detail_source(text,text,text) from public;

grant execute on function public.character2_create_character_preview_v2(uuid,text,text,text,jsonb,numeric,jsonb,jsonb,text,jsonb,jsonb) to anon;
grant execute on function public.character2_get_detail_source(text,text,text) to anon;
