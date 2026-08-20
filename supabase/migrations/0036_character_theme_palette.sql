-- Persist the owner-generated character color palette in passport_json so shared
-- summary/detail report pages can restore the same theme on every device.

create or replace function public.character2_set_character_theme(
  p_share_code text,
  p_edit_token text,
  p_theme jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_source text;
  v_confidence numeric;
begin
  if jsonb_typeof(p_theme) <> 'object' then return false; end if;
  if coalesce(p_theme->>'main','') !~* '^#[0-9a-f]{6}$' then return false; end if;
  if coalesce(p_theme->>'mainSub','') !~* '^#[0-9a-f]{6}$' then return false; end if;
  if coalesce(p_theme->>'point','') !~* '^#[0-9a-f]{6}$' then return false; end if;
  if coalesce(p_theme->>'pointSub','') !~* '^#[0-9a-f]{6}$' then return false; end if;
  v_source := coalesce(p_theme->>'source','');
  if v_source not in ('image','text','mixed') then return false; end if;
  if jsonb_typeof(p_theme->'confidence') <> 'number' then return false; end if;
  v_confidence := (p_theme->>'confidence')::numeric;
  if v_confidence < 0 or v_confidence > 100 then return false; end if;

  update public.character2_passports p
  set passport_json = jsonb_set(coalesce(p.passport_json,'{}'::jsonb), '{themePalette}', p_theme, true),
      updated_at = now()
  from public.character2_characters c
  join public.character2_access a on a.character_id = c.id
  where p.character_id = c.id
    and c.share_code = upper(trim(p_share_code))
    and a.edit_token_hash = encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex');

  return found;
end;
$$;

revoke all on function public.character2_set_character_theme(text,text,jsonb) from public;
grant execute on function public.character2_set_character_theme(text,text,jsonb) to anon;

create or replace function public.character2_get_public_preview(p_share_code text)
returns jsonb
language sql
stable security definer
set search_path = public
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
    end,
    'summaryTags', case
      when jsonb_typeof(p.passport_json #> '{analysis,summaryTags}') = 'object'
        then p.passport_json #> '{analysis,summaryTags}'
      else null
    end,
    'summaryCardLines', case
      when jsonb_typeof(p.passport_json #> '{analysis,summaryCardLines}') = 'object'
        then p.passport_json #> '{analysis,summaryCardLines}'
      else null
    end,
    'themePalette', case
      when jsonb_typeof(p.passport_json -> 'themePalette') = 'object'
        then p.passport_json -> 'themePalette'
      else null
    end
  )
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
  limit 1;
$$;

revoke all on function public.character2_get_public_preview(text) from public;
grant execute on function public.character2_get_public_preview(text) to anon;
