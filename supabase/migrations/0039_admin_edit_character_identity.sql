-- Allow the authenticated admin console to rename a character and edit/remove the owner name.
-- Character name is mirrored into passport_json because public report pages read the name there.
create or replace function public.character2_admin_update_identity(
  p_token text,
  p_share_code text,
  p_name text,
  p_owner_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_name text;
  v_owner_name text;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_owner_name := regexp_replace(btrim(coalesce(p_owner_name, '')), '\s+', ' ', 'g');

  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'CHARACTER_NAME_INVALID';
  end if;
  if length(v_owner_name) > 80 then
    raise exception 'OWNER_NAME_INVALID';
  end if;

  select id into v_id
  from public.character2_characters
  where share_code = upper(trim(p_share_code))
  limit 1;

  if v_id is null then
    return null;
  end if;

  update public.character2_characters
  set name = v_name,
      owner_name = nullif(v_owner_name, ''),
      updated_at = now()
  where id = v_id;

  update public.character2_passports
  set passport_json = jsonb_set(
        coalesce(passport_json, '{}'::jsonb),
        '{basicProfile}',
        coalesce(passport_json -> 'basicProfile', '{}'::jsonb) || jsonb_build_object('name', v_name),
        true
      ),
      updated_at = now()
  where character_id = v_id;

  return jsonb_build_object(
    'shareCode', upper(trim(p_share_code)),
    'name', v_name,
    'ownerName', nullif(v_owner_name, '')
  );
end;
$$;

revoke all on function public.character2_admin_update_identity(text,text,text,text) from public;
grant execute on function public.character2_admin_update_identity(text,text,text,text) to anon;
