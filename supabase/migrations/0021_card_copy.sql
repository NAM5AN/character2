-- Cache for playful share-card copy (nickname + tagline + short section lines),
-- generated once per character+mode with the cheap gpt engine and reused after.
-- Derived from already-public report data, so reads/writes are anon-callable.

create table if not exists public.character2_card_copy (
  character_id uuid not null references public.character2_characters(id) on delete cascade,
  mode text not null check (mode in ('summary','detail')),
  copy_json jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (character_id, mode)
);

create or replace function public.character2_get_card_copy(p_share_code text, p_mode text)
returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select cc.copy_json
  from public.character2_characters c
  join public.character2_card_copy cc on cc.character_id = c.id
  where c.share_code = upper(trim(p_share_code)) and cc.mode = p_mode
  limit 1;
$$;

create or replace function public.character2_set_card_copy(p_share_code text, p_mode text, p_copy jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if p_mode not in ('summary','detail') then return false; end if;
  if p_copy is null or jsonb_typeof(p_copy) <> 'object' then return false; end if;
  select id into v_id from public.character2_characters where share_code = upper(trim(p_share_code)) limit 1;
  if v_id is null then return false; end if;
  insert into public.character2_card_copy(character_id, mode, copy_json)
  values (v_id, p_mode, p_copy)
  on conflict (character_id, mode) do update set copy_json = excluded.copy_json, updated_at = now();
  return true;
end; $$;

revoke all on function public.character2_get_card_copy(text,text) from public;
revoke all on function public.character2_set_card_copy(text,text,jsonb) from public;
grant execute on function public.character2_get_card_copy(text,text) to anon;
grant execute on function public.character2_set_card_copy(text,text,jsonb) to anon;
