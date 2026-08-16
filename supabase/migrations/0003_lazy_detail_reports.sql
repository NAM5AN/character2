-- Lazy paid detail generation.
-- New characters store only public preview data in the passport. A compact,
-- non-verbatim analysis seed is stored separately and is available only after
-- validating the current paid access code through a SECURITY DEFINER RPC.

create table if not exists public.character2_private_reports (
  character_id uuid primary key references public.character2_characters(id) on delete cascade,
  detail_seed_json jsonb not null default '{}'::jsonb,
  detail_json jsonb,
  detail_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.character2_private_reports enable row level security;
revoke all on table public.character2_private_reports from anon, authenticated;

create or replace function public.character2_get_public_preview(p_share_code text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'name', coalesce(p.passport_json #>> '{basicProfile,name}', c.name),
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
    end
  )
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
  limit 1;
$$;

create or replace function public.character2_create_character_preview(
  p_character_id uuid, p_share_code text, p_name text, p_schema_version text,
  p_passport_json jsonb, p_analysis_confidence numeric, p_engine_versions jsonb,
  p_answers jsonb, p_edit_token_hash text, p_detail_seed_json jsonb
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

  insert into public.character2_private_reports(character_id,detail_seed_json)
  values(p_character_id,coalesce(p_detail_seed_json,'{}'::jsonb));

  return true;
end; $$;

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

create or replace function public.character2_save_detail(p_share_code text, p_access_code text, p_detail_json jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_character_id uuid;
begin
  if not public.character2_validate_access_code(p_access_code) then
    raise exception 'CODE_INVALID';
  end if;

  select id into v_character_id
  from public.character2_characters
  where share_code = upper(trim(p_share_code))
  limit 1;

  if v_character_id is null then return false; end if;

  update public.character2_private_reports
  set detail_json = p_detail_json,
      detail_generated_at = now(),
      updated_at = now()
  where character_id = v_character_id;

  return found;
end; $$;

-- Stop exposing the full stored passport through an anonymously callable RPC.
revoke execute on function public.character2_get_character(text) from anon, authenticated;

revoke all on function public.character2_get_public_preview(text) from public;
revoke all on function public.character2_create_character_preview(uuid,text,text,text,jsonb,numeric,jsonb,jsonb,text,jsonb) from public;
revoke all on function public.character2_get_detail_bundle(text,text) from public;
revoke all on function public.character2_save_detail(text,text,jsonb) from public;

grant execute on function public.character2_get_public_preview(text) to anon;
grant execute on function public.character2_create_character_preview(uuid,text,text,text,jsonb,numeric,jsonb,jsonb,text,jsonb) to anon;
grant execute on function public.character2_get_detail_bundle(text,text) to anon;
grant execute on function public.character2_save_detail(text,text,jsonb) to anon;
