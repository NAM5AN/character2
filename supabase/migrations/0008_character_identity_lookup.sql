-- Human-friendly character lookup without replacing the internal 8-character share code.
-- Existing character, passport, paid-detail and access-code flows keep using share_code internally.

alter table public.character2_characters
  add column if not exists owner_name text,
  add column if not exists character_name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  add column if not exists owner_name_key text generated always as (
    case when owner_name is null then null else lower(regexp_replace(btrim(owner_name), '\s+', ' ', 'g')) end
  ) stored;

create index if not exists character2_human_lookup_idx
  on public.character2_characters(character_name_key, owner_name_key, updated_at desc)
  where owner_name_key is not null;

create or replace function public.character2_set_owner_name(
  p_share_code text,
  p_edit_token text,
  p_owner_name text
)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_owner_name text;
begin
  v_owner_name := regexp_replace(btrim(coalesce(p_owner_name,'')), '\s+', ' ', 'g');
  if length(v_owner_name) < 1 or length(v_owner_name) > 80 then return false; end if;

  update public.character2_characters c
  set owner_name = v_owner_name,
      updated_at = now()
  from public.character2_access a
  where a.character_id = c.id
    and c.share_code = upper(trim(p_share_code))
    and a.edit_token_hash = encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex');

  return found;
end; $$;

create or replace function public.character2_lookup_character(
  p_name text,
  p_owner_name text
)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'shareCode', c.share_code,
    'name', c.name,
    'ownerName', c.owner_name
  )
  from public.character2_characters c
  where c.character_name_key = lower(regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g'))
    and c.owner_name_key = lower(regexp_replace(btrim(coalesce(p_owner_name,'')), '\s+', ' ', 'g'))
  order by c.updated_at desc, c.created_at desc
  limit 1;
$$;

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
    end
  )
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
  limit 1;
$$;

revoke all on function public.character2_set_owner_name(text,text,text) from public;
revoke all on function public.character2_lookup_character(text,text) from public;
grant execute on function public.character2_set_owner_name(text,text,text) to anon;
grant execute on function public.character2_lookup_character(text,text) to anon;
