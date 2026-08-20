-- Expose the stored dossier's version tag (not the dossier itself) so the precompute
-- route can skip work under exactly the same condition stage 1 uses to reuse it.
--
-- The bug: precompute skipped on age alone ("계산된 지 24시간 안 지났으니 넘어감"), while
-- stage 1 additionally required the tag to equal DETAIL_REPORT_VERSION|SKILL_VERSION.
-- After any prompt/skill bump the two disagreed — precompute reported "cached, nothing
-- to do" and stage 1 threw the stored dossier away as stale — so the optimization
-- silently stopped working and the owner waited the full generation every time, with
-- no signal that anything was wrong. Confirmed in production data: one character still
-- held a detail-analysis/6.6|character-deep-analysis/1.2.0 dossier against a current
-- 6.7|1.2.1, and would never have been refreshed.
create or replace function public.character2_get_owner_detail_inputs(p_share_code text, p_edit_token text)
returns jsonb
language sql stable security definer set search_path = public, extensions
as $function$
  select jsonb_build_object(
    'seed', r.detail_seed_json,
    'publicProfileText', coalesce(p.passport_json #>> '{basicProfile,profileText}', ''),
    'source', r.source_json,
    'precomputedAt', r.precomputed_dossier_at,
    'precomputedVersion', r.precomputed_dossier_json #>> '{_v}'
  )
  from public.character2_characters c
  join public.character2_access a on a.character_id = c.id
  join public.character2_passports p on p.character_id = c.id
  join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
    and length(trim(coalesce(p_edit_token,''))) >= 16
    and a.edit_token_hash = encode(extensions.digest(coalesce(p_edit_token,''),'sha256'),'hex')
  limit 1;
$function$;
