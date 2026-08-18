-- Owner-only settings, driven from the admin console (cookie/session gated,
-- not the standalone admin_secret page). Two needs:
--   1) show the current 결제코드(이용코드) in plaintext so the owner can read it, and
--   2) change it (and the Postype URL) right there.
-- The access code was previously stored only as a sha256 hash, which cannot be
-- shown. We add a plaintext mirror that ONLY the admin-session RPC can read; the
-- hash stays the source of truth for public validation (character2_validate_access_code).

alter table public.character2_app_settings
  add column if not exists ai_access_code_plain text not null default '';

-- Drop the orphaned earlier variants (p_session_token / session_valid). They were
-- never wired to any route; the live console uses p_token + character2_admin_session_ok.
drop function if exists public.character2_admin_get_settings(text);
drop function if exists public.character2_admin_update_settings(text, text, text);

-- Read current settings for the console. Requires a valid admin session token.
create or replace function public.character2_admin_get_settings(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare s public.character2_app_settings;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;
  select * into s from public.character2_app_settings where id = 1;
  return jsonb_build_object(
    'postypeUrl', coalesce(s.postype_url, ''),
    'accessCode', coalesce(s.ai_access_code_plain, ''),
    'codeVersion', coalesce(s.code_version, 1),
    'hasHash', (coalesce(s.ai_access_code_hash, '') <> '')
  );
end; $$;

-- Update settings from the console. Requires a valid admin session token.
-- Empty p_access_code -> keep the existing code (only the Postype URL changes).
-- A changed code bumps code_version so browsers holding the old code re-validate.
create or replace function public.character2_admin_update_settings(
  p_token text, p_postype_url text, p_access_code text
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_code text; v_version integer; v_plain text;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;
  v_code := trim(coalesce(p_access_code, ''));
  select ai_access_code_plain, code_version into v_plain, v_version
    from public.character2_app_settings where id = 1;

  if v_code = '' or v_code = coalesce(v_plain, '') then
    -- code unchanged: only refresh the Postype URL, keep version.
    update public.character2_app_settings
      set postype_url = coalesce(p_postype_url, ''), updated_at = now()
      where id = 1;
  else
    v_version := coalesce(v_version, 1) + 1;
    update public.character2_app_settings set
      postype_url = coalesce(p_postype_url, ''),
      ai_access_code_hash = encode(extensions.digest(v_code, 'sha256'), 'hex'),
      ai_access_code_plain = v_code,
      code_version = v_version,
      updated_at = now()
    where id = 1;
    v_plain := v_code;
  end if;

  return jsonb_build_object(
    'postypeUrl', coalesce(p_postype_url, ''),
    'accessCode', coalesce(v_plain, ''),
    'codeVersion', coalesce(v_version, 1)
  );
end; $$;

revoke all on function public.character2_admin_get_settings(text) from public;
revoke all on function public.character2_admin_update_settings(text, text, text) from public;
grant execute on function public.character2_admin_get_settings(text) to anon;
grant execute on function public.character2_admin_update_settings(text, text, text) to anon;
