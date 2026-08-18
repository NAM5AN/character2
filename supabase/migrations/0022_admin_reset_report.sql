-- Admin: roll a character back to an earlier state for fast re-testing.
--   target 'summary'  -> keep summary, drop the detail report + paid entitlement +
--                        precompute + detail timing. Owner can re-unlock and the
--                        detail report regenerates with the current prompts.
--   target 'answers'  -> the above, plus wipe the passport analysis (summary), back
--                        to the interview-answered-only state.
-- The detail seed and private source are kept so detail can be regenerated.

create or replace function public.character2_admin_reset_report(p_token text, p_share_code text, p_target text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;
  if p_target not in ('summary','answers') then
    raise exception 'RESET_TARGET_INVALID';
  end if;

  select id into v_id from public.character2_characters
  where share_code = upper(trim(p_share_code)) limit 1;
  if v_id is null then return false; end if;

  -- 상세 리포트 관련 상태 초기화 (두 타깃 공통).
  update public.character2_private_reports
  set detail_json = null,
      detail_generated_at = null,
      precomputed_dossier_json = null,
      precomputed_dossier_at = null,
      updated_at = now()
  where character_id = v_id;

  update public.character2_access
  set paid_unlocked_at = null,
      detail_view_token_hash = null,
      detail_view_token_issued_at = null
  where character_id = v_id;

  update public.character2_gen_timings
  set detail_started_at = null, detail_ms = null, updated_at = now()
  where character_id = v_id;

  if p_target = 'answers' then
    -- 요약(패스포트 analysis)까지 비운다.
    update public.character2_passports
    set passport_json = jsonb_set(
          passport_json,
          '{analysis}',
          jsonb_build_object(
            'oneLineSummary','',
            'summary', jsonb_build_object('outerSelf','','innerSelf','','conflictStyle','','affectionStyle','')
          )
        ),
        updated_at = now()
    where character_id = v_id;

    update public.character2_gen_timings
    set summary_ms = null, updated_at = now()
    where character_id = v_id;
  end if;

  return true;
end; $$;

revoke all on function public.character2_admin_reset_report(text,text,text) from public;
grant execute on function public.character2_admin_reset_report(text,text,text) to anon;
