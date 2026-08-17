-- Per-character paid-detail entitlement.
-- The rotating Postype code is used only to claim a character once. Reopening and
-- continuing that character's report uses a long random browser token (stored only as a hash)
-- or the creator edit token.

alter table public.character2_access
  add column if not exists paid_unlocked_at timestamptz,
  add column if not exists detail_view_token_hash text,
  add column if not exists detail_view_token_issued_at timestamptz;

-- Existing rows with a saved paid report are already entitled. They can claim their first
-- browser token using the current paid code; after a token exists, rotating it requires the
-- creator edit token.
update public.character2_access a
set paid_unlocked_at = coalesce(r.detail_generated_at, r.created_at, a.created_at)
from public.character2_private_reports r
where r.character_id = a.character_id
  and r.detail_json is not null
  and a.paid_unlocked_at is null;

create or replace function public.character2_claim_detail_entitlement(
  p_share_code text,
  p_access_code text,
  p_detail_view_token_hash text,
  p_edit_token text default ''
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_character_id uuid;
  v_paid_unlocked_at timestamptz;
  v_existing_token_hash text;
  v_edit_token_hash text;
  v_edit_valid boolean := false;
  v_result jsonb;
begin
  if lower(trim(coalesce(p_detail_view_token_hash,''))) !~ '^[0-9a-f]{64}$' then
    raise exception 'DETAIL_TOKEN_INVALID';
  end if;

  select c.id, a.paid_unlocked_at, a.detail_view_token_hash, a.edit_token_hash
  into v_character_id, v_paid_unlocked_at, v_existing_token_hash, v_edit_token_hash
  from public.character2_characters c
  join public.character2_access a on a.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
  limit 1;

  if v_character_id is null then return null; end if;

  v_edit_valid := length(trim(coalesce(p_edit_token,''))) >= 16
    and v_edit_token_hash = encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex');

  -- A creator may restore or rotate the browser token after the character was paid once.
  -- Everyone else must use the current rotating Postype code for the first claim only.
  if not (v_paid_unlocked_at is not null and v_edit_valid)
    and not public.character2_validate_access_code(p_access_code) then
    raise exception 'CODE_INVALID';
  end if;

  if v_paid_unlocked_at is not null
    and v_existing_token_hash is not null
    and not v_edit_valid then
    raise exception 'DETAIL_ENTITLEMENT_ALREADY_CLAIMED';
  end if;

  update public.character2_access
  set paid_unlocked_at = coalesce(paid_unlocked_at, now()),
      detail_view_token_hash = lower(trim(p_detail_view_token_hash)),
      detail_view_token_issued_at = now()
  where character_id = v_character_id;

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
  ) into v_result
  from public.character2_passports p
  left join public.character2_private_reports r on r.character_id = p.character_id
  where p.character_id = v_character_id;

  return v_result;
end; $$;

create or replace function public.character2_get_entitled_detail_bundle(
  p_share_code text,
  p_detail_view_token text default '',
  p_edit_token text default ''
)
returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
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
  )
  from public.character2_characters c
  join public.character2_access a on a.character_id = c.id
  join public.character2_passports p on p.character_id = c.id
  left join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and a.paid_unlocked_at is not null
    and (
      (
        length(trim(coalesce(p_detail_view_token,''))) >= 16
        and a.detail_view_token_hash = encode(extensions.digest(coalesce(p_detail_view_token,''),'sha256'),'hex')
      )
      or (
        length(trim(coalesce(p_edit_token,''))) >= 16
        and a.edit_token_hash = encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex')
      )
    )
  limit 1;
$$;

create or replace function public.character2_get_entitled_detail_source(
  p_share_code text,
  p_edit_token text
)
returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select r.source_json
  from public.character2_characters c
  join public.character2_access a on a.character_id = c.id
  join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and a.paid_unlocked_at is not null
    and length(trim(coalesce(p_edit_token,''))) >= 16
    and a.edit_token_hash = encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex')
  limit 1;
$$;

create or replace function public.character2_save_entitled_detail(
  p_share_code text,
  p_detail_view_token text default '',
  p_edit_token text default '',
  p_detail_json jsonb default '{}'::jsonb
)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_character_id uuid;
begin
  if p_detail_json is null or jsonb_typeof(p_detail_json) <> 'object' then
    raise exception 'DETAIL_JSON_INVALID';
  end if;

  select c.id into v_character_id
  from public.character2_characters c
  join public.character2_access a on a.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and a.paid_unlocked_at is not null
    and (
      (
        length(trim(coalesce(p_detail_view_token,''))) >= 16
        and a.detail_view_token_hash = encode(extensions.digest(coalesce(p_detail_view_token,''),'sha256'),'hex')
      )
      or (
        length(trim(coalesce(p_edit_token,''))) >= 16
        and a.edit_token_hash = encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex')
      )
    )
  limit 1;

  if v_character_id is null then
    raise exception 'DETAIL_ACCESS_DENIED';
  end if;

  update public.character2_private_reports
  set detail_json = p_detail_json,
      detail_generated_at = now(),
      updated_at = now()
  where character_id = v_character_id;

  return found;
end; $$;

revoke all on function public.character2_claim_detail_entitlement(text,text,text,text) from public;
revoke all on function public.character2_get_entitled_detail_bundle(text,text,text) from public;
revoke all on function public.character2_get_entitled_detail_source(text,text) from public;
revoke all on function public.character2_save_entitled_detail(text,text,text,jsonb) from public;

grant execute on function public.character2_claim_detail_entitlement(text,text,text,text) to anon;
grant execute on function public.character2_get_entitled_detail_bundle(text,text,text) to anon;
grant execute on function public.character2_get_entitled_detail_source(text,text) to anon;
grant execute on function public.character2_save_entitled_detail(text,text,text,jsonb) to anon;
