-- Read-only administrator data browser with short-lived server sessions.
-- The browser never receives the administrator secret after login, and no edit or
-- paid-detail access token hashes are returned by these RPCs.

create table if not exists public.character2_admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now()
);

create index if not exists character2_admin_sessions_expiry
  on public.character2_admin_sessions(expires_at);

alter table public.character2_admin_sessions enable row level security;
revoke all on table public.character2_admin_sessions from anon, authenticated;

create or replace function public.character2_admin_create_session(
  p_admin_secret text,
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_hash text;
begin
  if char_length(coalesce(p_session_token, '')) < 32 then
    return false;
  end if;

  if not exists (
    select 1
    from public.character2_app_settings s
    where s.id = 1
      and s.admin_secret_hash = encode(extensions.digest(coalesce(p_admin_secret, ''), 'sha256'), 'hex')
  ) then
    return false;
  end if;

  delete from public.character2_admin_sessions where expires_at <= now();
  v_token_hash := encode(extensions.digest(p_session_token, 'sha256'), 'hex');

  insert into public.character2_admin_sessions(token_hash, expires_at, last_used_at)
  values(v_token_hash, now() + interval '12 hours', now())
  on conflict(token_hash) do update
    set expires_at = excluded.expires_at,
        last_used_at = excluded.last_used_at;

  return true;
end;
$$;

create or replace function public.character2_admin_session_valid(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_hash text;
begin
  if char_length(coalesce(p_session_token, '')) < 32 then
    return false;
  end if;

  v_token_hash := encode(extensions.digest(p_session_token, 'sha256'), 'hex');
  update public.character2_admin_sessions
  set last_used_at = now()
  where token_hash = v_token_hash
    and expires_at > now();

  return found;
end;
$$;

create or replace function public.character2_admin_end_session(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from public.character2_admin_sessions
  where token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex');
  return found;
end;
$$;

create or replace function public.character2_admin_get_settings(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  if not public.character2_admin_session_valid(p_session_token) then
    return null;
  end if;

  select jsonb_build_object(
    'postypeUrl', s.postype_url,
    'codeVersion', s.code_version,
    'updatedAt', s.updated_at
  )
  into v_result
  from public.character2_app_settings s
  where s.id = 1;

  return v_result;
end;
$$;

create or replace function public.character2_admin_update_settings(
  p_session_token text,
  p_postype_url text,
  p_access_code text
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_next_version integer;
begin
  if not public.character2_admin_session_valid(p_session_token) then
    return null;
  end if;

  if char_length(trim(coalesce(p_access_code, ''))) < 4 then
    raise exception 'ACCESS_CODE_INVALID';
  end if;

  select code_version + 1
  into v_next_version
  from public.character2_app_settings
  where id = 1;

  update public.character2_app_settings
  set postype_url = coalesce(p_postype_url, ''),
      ai_access_code_hash = encode(extensions.digest(trim(p_access_code), 'sha256'), 'hex'),
      code_version = v_next_version,
      updated_at = now()
  where id = 1;

  return v_next_version;
end;
$$;

create or replace function public.character2_admin_list_characters(
  p_session_token text,
  p_query text default '',
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := trim(coalesce(p_query, ''));
begin
  if not public.character2_admin_session_valid(p_session_token) then
    return null;
  end if;

  with filtered as (
    select
      c.id,
      c.share_code,
      c.name,
      c.owner_name,
      c.status,
      c.schema_version,
      c.created_at,
      c.updated_at,
      p.passport_json,
      p.analysis_confidence,
      r.detail_json,
      r.detail_generated_at,
      r.source_json,
      a.paid_unlocked_at,
      (
        select count(*)
        from public.character2_answers answer_row
        where answer_row.character_id = c.id
      ) as answer_count
    from public.character2_characters c
    join public.character2_passports p on p.character_id = c.id
    left join public.character2_private_reports r on r.character_id = c.id
    left join public.character2_access a on a.character_id = c.id
    where v_query = ''
       or c.share_code ilike '%' || v_query || '%'
       or c.name ilike '%' || v_query || '%'
       or coalesce(c.owner_name, '') ilike '%' || v_query || '%'
  ),
  page_rows as (
    select *
    from filtered
    order by created_at desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'shareCode', row.share_code,
          'name', row.name,
          'ownerName', row.owner_name,
          'status', row.status,
          'schemaVersion', row.schema_version,
          'createdAt', row.created_at,
          'updatedAt', row.updated_at,
          'analysisConfidence', row.analysis_confidence,
          'oneLineSummary', coalesce(row.passport_json #>> '{analysis,oneLineSummary}', ''),
          'hasSummary', jsonb_typeof(row.passport_json #> '{analysis,summary}') = 'object',
          'hasDetail', row.detail_json is not null,
          'detailStage', case
            when coalesce(row.detail_json->>'detailStage', '') in ('1','2','3')
              then (row.detail_json->>'detailStage')::integer
            when length(btrim(coalesce(row.detail_json->>'integratedReport', ''))) > 0 then 3
            when length(btrim(coalesce(row.detail_json->>'detailedReport', ''))) > 0 then 3
            when length(btrim(coalesce(row.detail_json->>'relationshipStyle', ''))) > 0 then 2
            when length(btrim(coalesce(row.detail_json->>'characterOverview', ''))) > 0 then 1
            else 0
          end,
          'detailGeneratedAt', row.detail_generated_at,
          'paidUnlockedAt', row.paid_unlocked_at,
          'answerCount', row.answer_count,
          'publicProfileLength', char_length(coalesce(row.passport_json #>> '{basicProfile,profileText}', '')),
          'privateProfileLength', char_length(coalesce(row.source_json->>'secretProfileText', ''))
        )
        order by row.created_at desc
      )
      from page_rows row
    ), '[]'::jsonb),
    'filteredTotal', (select count(*) from filtered),
    'limit', v_limit,
    'offset', v_offset,
    'metrics', jsonb_build_object(
      'characters', (select count(*) from public.character2_characters),
      'withOwner', (select count(*) from public.character2_characters where nullif(trim(coalesce(owner_name, '')), '') is not null),
      'withSummary', (
        select count(*)
        from public.character2_passports p2
        where jsonb_typeof(p2.passport_json #> '{analysis,summary}') = 'object'
      ),
      'withDetail', (
        select count(*)
        from public.character2_private_reports r2
        where r2.detail_json is not null
      )
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.character2_admin_get_character(
  p_session_token text,
  p_share_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  if not public.character2_admin_session_valid(p_session_token) then
    return null;
  end if;

  select jsonb_build_object(
    'character', jsonb_build_object(
      'id', c.id,
      'shareCode', c.share_code,
      'name', c.name,
      'ownerName', c.owner_name,
      'status', c.status,
      'schemaVersion', c.schema_version,
      'createdAt', c.created_at,
      'updatedAt', c.updated_at,
      'paidUnlockedAt', a.paid_unlocked_at,
      'detailGeneratedAt', r.detail_generated_at,
      'analysisConfidence', p.analysis_confidence,
      'engineVersions', p.engine_versions
    ),
    'profiles', jsonb_build_object(
      'age', p.passport_json #> '{basicProfile,age}',
      'gender', p.passport_json #> '{basicProfile,gender}',
      'publicProfileText', coalesce(p.passport_json #>> '{basicProfile,profileText}', ''),
      'secretProfileText', coalesce(r.source_json->>'secretProfileText', '')
    ),
    'analysis', jsonb_build_object(
      'traits', coalesce(p.passport_json->'traits', '{}'::jsonb),
      'relationshipTraits', coalesce(p.passport_json->'relationshipTraits', '{}'::jsonb),
      'confirmedFacts', coalesce(p.passport_json->'confirmedFacts', '[]'::jsonb),
      'aiInferences', coalesce(p.passport_json->'aiInferences', '[]'::jsonb),
      'ownerReview', coalesce(r.source_json->'ownerReview', '{}'::jsonb),
      'detailSeed', coalesce(r.detail_seed_json, '{}'::jsonb),
      'detailDossier', r.detail_json->'_detailDossier'
    ),
    'summaryReport', jsonb_build_object(
      'oneLineSummary', coalesce(p.passport_json #>> '{analysis,oneLineSummary}', ''),
      'summary', coalesce(p.passport_json #> '{analysis,summary}', '{}'::jsonb)
    ),
    'detailReport', case
      when r.detail_json is null then null
      else r.detail_json - '_detailDossier'
    end,
    'answers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'order', answer_row.question_order,
          'question', answer_row.question_text,
          'answer', answer_row.answer_json->>'answer',
          'reason', answer_row.answer_json->>'reason',
          'branchContext', answer_row.branch_context,
          'engineVersion', answer_row.question_engine_version,
          'createdAt', answer_row.created_at
        )
        order by answer_row.question_order
      )
      from public.character2_answers answer_row
      where answer_row.character_id = c.id
    ), '[]'::jsonb),
    'raw', jsonb_build_object(
      'passportJson', p.passport_json,
      'sourceJson', r.source_json,
      'detailSeedJson', r.detail_seed_json,
      'detailJson', r.detail_json
    )
  )
  into v_result
  from public.character2_characters c
  join public.character2_passports p on p.character_id = c.id
  left join public.character2_private_reports r on r.character_id = c.id
  left join public.character2_access a on a.character_id = c.id
  where c.share_code = upper(trim(p_share_code))
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.character2_admin_create_session(text,text) from public;
revoke all on function public.character2_admin_session_valid(text) from public;
revoke all on function public.character2_admin_end_session(text) from public;
revoke all on function public.character2_admin_get_settings(text) from public;
revoke all on function public.character2_admin_update_settings(text,text,text) from public;
revoke all on function public.character2_admin_list_characters(text,text,integer,integer) from public;
revoke all on function public.character2_admin_get_character(text,text) from public;

grant execute on function public.character2_admin_create_session(text,text) to anon;
grant execute on function public.character2_admin_end_session(text) to anon;
grant execute on function public.character2_admin_get_settings(text) to anon;
grant execute on function public.character2_admin_update_settings(text,text,text) to anon;
grant execute on function public.character2_admin_list_characters(text,text,integer,integer) to anon;
grant execute on function public.character2_admin_get_character(text,text) to anon;
