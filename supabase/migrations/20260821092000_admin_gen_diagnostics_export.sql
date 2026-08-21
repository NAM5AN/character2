-- Mirrors the production migration `admin_gen_diagnostics_export` applied on 2026-08-21.
-- It keeps active generation heartbeats, clears retained diagnostics on the admin
-- all-clear action, and exposes owner-authenticated rows for CSV export.

create or replace function public.character2_admin_delete_gen_failures(p_token text,p_ids bigint[] default null,p_all boolean default false)
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare v_deleted integer:=0; v_part integer:=0;
begin
  if not public.character2_admin_session_ok(p_token) then raise exception 'ADMIN_AUTH_INVALID'; end if;
  if coalesce(p_all,false) then
    delete from public.character2_gen_failures where kind in ('failure','retry');
    get diagnostics v_part=row_count; v_deleted:=v_deleted+v_part;
    delete from public.character2_gen_inflight where started_at < now()-interval '6 minutes';
    get diagnostics v_part=row_count; v_deleted:=v_deleted+v_part;
    return v_deleted;
  end if;
  if p_ids is null or cardinality(p_ids)=0 then return 0; end if;
  if cardinality(p_ids)>100 then raise exception 'TOO_MANY_FAILURE_IDS'; end if;
  delete from public.character2_gen_failures where kind='failure' and id=any(p_ids);
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;$$;
revoke all on function public.character2_admin_delete_gen_failures(text,bigint[],boolean) from public;
grant execute on function public.character2_admin_delete_gen_failures(text,bigint[],boolean) to anon;

create or replace function public.character2_admin_gen_diagnostics_export(p_token text,p_limit integer default 5000)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,5000),1),10000); v_rows jsonb;
begin
  if not public.character2_admin_session_ok(p_token) then raise exception 'ADMIN_AUTH_INVALID'; end if;
  with all_rows as (
    select f.created_at event_at,jsonb_build_object(
      'recordType',case when f.kind='retry' then 'retry' else 'failure' end,'id',f.id::text,'eventAt',f.created_at,'startedAt',null,
      'stage',f.stage,'shareCode',coalesce(f.share_code,us.share_code,c.share_code),'sessionId',f.session_id::text,
      'operationId',to_jsonb(f)->>'operation_id','attemptId',to_jsonb(f)->>'attempt_id','model',to_jsonb(f)->>'model','errorCode',f.error_code,'errorDetail',f.error_detail,
      'minutesStuck',null,'characterName',coalesce(nullif(trim(to_jsonb(f)->>'character_name'),''),nullif(trim(p.passport_json#>>'{basicProfile,name}'),''),nullif(trim(c.name),'')),'ownerName',c.owner_name) row_data
    from public.character2_gen_failures f
    left join public.character2_ai_usage_sessions us on us.usage_session_id=f.session_id
    left join public.character2_characters c on c.id=us.character_id or (us.character_id is null and c.share_code=f.share_code)
    left join public.character2_passports p on p.character_id=c.id
    where f.kind in ('failure','retry')
    union all
    select i.started_at event_at,jsonb_build_object(
      'recordType','timeout','id',i.id::text,'eventAt',i.started_at,'startedAt',i.started_at,'stage',i.stage,
      'shareCode',coalesce(i.share_code,us.share_code,c.share_code),'sessionId',i.session_id::text,'operationId',null,'attemptId',null,'model',null,
      'errorCode','TIMEOUT_OR_PROCESS_KILL','errorDetail','6분 넘게 완료되지 않아 heartbeat가 남은 생성입니다. 300초 제한 초과 타임아웃 또는 프로세스 강제 종료로 추정합니다.',
      'minutesStuck',round(extract(epoch from(now()-i.started_at))/60)::integer,'characterName',coalesce(nullif(trim(to_jsonb(i)->>'character_name'),''),nullif(trim(p.passport_json#>>'{basicProfile,name}'),''),nullif(trim(c.name),'')),'ownerName',c.owner_name) row_data
    from public.character2_gen_inflight i
    left join public.character2_ai_usage_sessions us on us.usage_session_id=i.session_id
    left join public.character2_characters c on c.id=us.character_id or (us.character_id is null and c.share_code=i.share_code)
    left join public.character2_passports p on p.character_id=c.id
    where i.started_at < now()-interval '6 minutes'
  ),limited as(select event_at,row_data from all_rows order by event_at desc limit v_limit)
  select coalesce(jsonb_agg(row_data order by event_at desc),'[]'::jsonb) into v_rows from limited;
  return v_rows;
end;$$;
revoke all on function public.character2_admin_gen_diagnostics_export(text,integer) from public;
grant execute on function public.character2_admin_gen_diagnostics_export(text,integer) to anon;
