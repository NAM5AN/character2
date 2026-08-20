-- 오너명 저장 시 "같은 캐릭터명 + 같은 오너명" 조합이 이미 다른 캐릭터에 존재하면
-- 저장을 막는다(하드 블록). 동일인이 같은 캐릭터를 실수로 또 만들어 이름 조회가
-- 최신 1건만 반환되는 문제를 예방하고, 정말 다른 사람이면 오너명을 바꾸도록 유도한다.
--
-- 반환 타입은 boolean 그대로 유지한다(성공=true, 토큰/캐릭터 실패=false). 중복은
-- 정상 반환값이 아니라 예외로 신호하므로, 이 마이그레이션이 코드 배포보다 먼저
-- 적용돼도 기존 성공 경로(true 반환)는 그대로 동작한다. 라우트는 예외 메시지에
-- 'OWNER_NAME_DUPLICATE' 가 있으면 409 로 변환한다.

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
  v_owner_key text;
  v_id uuid;
  v_name_key text;
begin
  v_owner_name := regexp_replace(btrim(coalesce(p_owner_name,'')), '\s+', ' ', 'g');
  if length(v_owner_name) < 1 or length(v_owner_name) > 80 then return false; end if;
  v_owner_key := lower(v_owner_name);

  -- 편집 토큰으로 대상 캐릭터를 먼저 특정한다.
  select c.id, c.character_name_key
    into v_id, v_name_key
  from public.character2_characters c
  join public.character2_access a on a.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and a.edit_token_hash = encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex');

  if v_id is null then return false; end if;

  -- 자기 자신을 제외하고, 같은 캐릭터명 + 같은 오너명 조합이 이미 있으면 막는다.
  if exists (
    select 1
    from public.character2_characters c2
    where c2.id <> v_id
      and c2.character_name_key = v_name_key
      and c2.owner_name_key = v_owner_key
  ) then
    raise exception 'OWNER_NAME_DUPLICATE' using errcode = 'unique_violation';
  end if;

  update public.character2_characters c
  set owner_name = v_owner_name,
      updated_at = now()
  where c.id = v_id;

  return true;
end; $$;

revoke all on function public.character2_set_owner_name(text,text,text) from public;
grant execute on function public.character2_set_owner_name(text,text,text) to anon;
