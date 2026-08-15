-- character2 capability-style RPC API.
-- Direct table access stays blocked. Public RPCs validate share code, edit token,
-- AI access code, or administrator secret as appropriate.

update public.character2_app_settings
set admin_secret_hash = '9d33818c404541d2bcf861d009800b7fa754d84bd633f5337d53bd2f6c123c10'
where id = 1 and admin_secret_hash = '';

create or replace function public.character2_get_settings()
returns table(postype_url text, code_version integer)
language sql security definer set search_path = public, extensions
as $$ select s.postype_url, s.code_version from public.character2_app_settings s where s.id = 1; $$;

create or replace function public.character2_validate_access_code(p_code text)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.character2_app_settings s
    where s.id = 1
      and s.ai_access_code_hash = encode(extensions.digest(trim(coalesce(p_code,'')), 'sha256'), 'hex')
  );
$$;

create or replace function public.character2_share_code_exists(p_share_code text)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.character2_characters c where c.share_code = upper(trim(p_share_code))); $$;

create or replace function public.character2_get_character(p_share_code text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select p.passport_json
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  where c.share_code = upper(trim(p_share_code)) limit 1;
$$;

create or replace function public.character2_create_character(
  p_character_id uuid, p_share_code text, p_name text, p_schema_version text,
  p_passport_json jsonb, p_analysis_confidence numeric, p_engine_versions jsonb,
  p_answers jsonb, p_edit_token_hash text, p_access_code text
)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare item jsonb;
begin
  if not public.character2_validate_access_code(p_access_code) then raise exception 'CODE_INVALID'; end if;
  if upper(trim(p_share_code)) !~ '^[A-HJ-NP-Z2-9]{8}$' then raise exception 'INVALID_SHARE_CODE'; end if;
  insert into public.character2_characters(id,share_code,name,status,schema_version)
  values(p_character_id,upper(trim(p_share_code)),p_name,'ready',p_schema_version);
  insert into public.character2_passports(character_id,passport_json,analysis_confidence,engine_versions)
  values(p_character_id,p_passport_json,p_analysis_confidence,coalesce(p_engine_versions,'{}'::jsonb));
  for item in select * from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) loop
    insert into public.character2_answers(character_id,question_order,question_text,answer_json,branch_context,question_engine_version)
    values(p_character_id,(item->>'order')::integer,item->>'question',jsonb_build_object('answer',item->>'answer'),coalesce(item->'branchContext','{}'::jsonb),'interview/1.0');
  end loop;
  insert into public.character2_access(character_id,edit_token_hash) values(p_character_id,p_edit_token_hash);
  return true;
end; $$;

create or replace function public.character2_delete_character(p_share_code text, p_edit_token text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_character_id uuid;
begin
  select c.id into v_character_id from public.character2_characters c
  join public.character2_access a on a.character_id=c.id
  where c.share_code=upper(trim(p_share_code))
    and a.edit_token_hash=encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex');
  if v_character_id is null then return false; end if;
  delete from public.character2_characters where id=v_character_id;
  return true;
end; $$;

create or replace function public.character2_rate_limit_check(p_ip_hash text,p_action text,p_limit integer,p_window_minutes integer)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  select count(*) into v_count from public.character2_rate_limit_events
  where ip_hash=p_ip_hash and action=p_action
    and created_at>=now()-make_interval(mins=>greatest(p_window_minutes,1));
  if v_count>=greatest(p_limit,1) then return false; end if;
  insert into public.character2_rate_limit_events(ip_hash,action) values(p_ip_hash,p_action);
  return true;
end; $$;

create or replace function public.character2_update_settings(p_admin_secret text,p_postype_url text,p_access_code text)
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare v_next_version integer;
begin
  if not exists(select 1 from public.character2_app_settings s where s.id=1
    and s.admin_secret_hash=encode(extensions.digest(coalesce(p_admin_secret,''),'sha256'),'hex')) then
    raise exception 'ADMIN_SECRET_INVALID';
  end if;
  select code_version+1 into v_next_version from public.character2_app_settings where id=1;
  update public.character2_app_settings set postype_url=coalesce(p_postype_url,''),
    ai_access_code_hash=encode(extensions.digest(trim(coalesce(p_access_code,'')),'sha256'),'hex'),
    code_version=v_next_version,updated_at=now() where id=1;
  return v_next_version;
end; $$;

revoke all on function public.character2_get_settings() from public;
revoke all on function public.character2_validate_access_code(text) from public;
revoke all on function public.character2_share_code_exists(text) from public;
revoke all on function public.character2_get_character(text) from public;
revoke all on function public.character2_create_character(uuid,text,text,text,jsonb,numeric,jsonb,jsonb,text,text) from public;
revoke all on function public.character2_delete_character(text,text) from public;
revoke all on function public.character2_rate_limit_check(text,text,integer,integer) from public;
revoke all on function public.character2_update_settings(text,text,text) from public;

grant execute on function public.character2_get_settings() to anon;
grant execute on function public.character2_validate_access_code(text) to anon;
grant execute on function public.character2_share_code_exists(text) to anon;
grant execute on function public.character2_get_character(text) to anon;
grant execute on function public.character2_create_character(uuid,text,text,text,jsonb,numeric,jsonb,jsonb,text,text) to anon;
grant execute on function public.character2_delete_character(text,text) to anon;
grant execute on function public.character2_rate_limit_check(text,text,integer,integer) to anon;
grant execute on function public.character2_update_settings(text,text,text) to anon;
