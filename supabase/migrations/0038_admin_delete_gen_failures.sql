-- Admin-only cleanup for AI generation failure logs.
-- This deliberately deletes only kind='failure' rows. Retry diagnostics and inflight
-- generation state are separate signals and must remain intact.

create or replace function public.character2_admin_delete_gen_failures(
  p_token text,
  p_ids bigint[] default null,
  p_all boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_deleted integer := 0;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  if coalesce(p_all, false) then
    delete from public.character2_gen_failures
    where kind = 'failure';
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  if cardinality(p_ids) > 100 then
    raise exception 'TOO_MANY_FAILURE_IDS';
  end if;

  delete from public.character2_gen_failures
  where kind = 'failure'
    and id = any(p_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.character2_admin_delete_gen_failures(text,bigint[],boolean) from public;
grant execute on function public.character2_admin_delete_gen_failures(text,bigint[],boolean) to anon;
