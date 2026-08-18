-- Admin: regenerate the summary report for an existing character from stored data
-- (passport + private source) using the current prompts, for fast testing.
--   get_summary_inputs -> returns the stored passport + source needed to rebuild inputs.
--   save_summary       -> writes the new analysis + detail seed, and clears the detail
--                          report/entitlement/precompute (the seed changed), leaving a
--                          clean "summary regenerated" state.

create or replace function public.character2_admin_get_summary_inputs(p_token text, p_share_code text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare result jsonb;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;
  select jsonb_build_object(
    'passport', p.passport_json,
    'source', r.source_json,
    'analysisConfidence', p.analysis_confidence
  ) into result
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  left join public.character2_private_reports r on r.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
  limit 1;
  return result;
end; $$;

create or replace function public.character2_admin_save_summary(
  p_token text, p_share_code text, p_analysis jsonb, p_detail_seed jsonb, p_summary_ms integer
) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;
  select id into v_id from public.character2_characters where share_code = upper(trim(p_share_code)) limit 1;
  if v_id is null then return false; end if;

  update public.character2_passports
  set passport_json = jsonb_set(passport_json, '{analysis}', p_analysis), updated_at = now()
  where character_id = v_id;

  update public.character2_private_reports
  set detail_seed_json = p_detail_seed,
      detail_json = null, detail_generated_at = null,
      precomputed_dossier_json = null, precomputed_dossier_at = null,
      updated_at = now()
  where character_id = v_id;

  update public.character2_access
  set paid_unlocked_at = null, detail_view_token_hash = null, detail_view_token_issued_at = null
  where character_id = v_id;

  insert into public.character2_gen_timings(character_id, summary_ms)
  values (v_id, p_summary_ms)
  on conflict (character_id) do update
    set summary_ms = excluded.summary_ms, detail_started_at = null, detail_ms = null, updated_at = now();

  return true;
end; $$;

revoke all on function public.character2_admin_get_summary_inputs(text,text) from public;
revoke all on function public.character2_admin_save_summary(text,text,jsonb,jsonb,integer) from public;
grant execute on function public.character2_admin_get_summary_inputs(text,text) to anon;
grant execute on function public.character2_admin_save_summary(text,text,jsonb,jsonb,integer) to anon;
