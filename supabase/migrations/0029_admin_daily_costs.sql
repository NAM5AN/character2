-- Daily cost rollup for the admin console cost-trend graph.
-- Buckets AI usage by KST calendar day so the owner can see spend over time and
-- catch a sudden jump (e.g. a runaway loop) that per-character cards don't reveal.
--
-- Cost is computed with the SAME method as the per-character cards so the graph
-- stays consistent with the rest of the console:
--   claude/actual = sum(cost_usd) reported by the gateway (mostly Claude),
--   gpt/estimated = openai tokens priced client-side via GPT_RATE.
-- The RPC returns raw claude cost + openai token sums per day; the client applies
-- the gpt rate and KRW conversion using its existing helpers.
create or replace function public.character2_admin_daily_costs(p_token text, p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  result jsonb;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  with series as (
    select generate_series(
      (now() at time zone 'Asia/Seoul')::date - make_interval(days => v_days - 1),
      (now() at time zone 'Asia/Seoul')::date,
      interval '1 day'
    )::date as d
  ),
  agg as (
    select
      (created_at at time zone 'Asia/Seoul')::date as d,
      sum(coalesce(cost_usd, 0)) as claude_cost,
      sum(case when model like 'openai/%' then input_tokens else 0 end) as gpt_in,
      sum(case when model like 'openai/%' then output_tokens else 0 end) as gpt_out,
      count(distinct usage_session_id) as sessions
    from public.character2_ai_usage_events
    where (created_at at time zone 'Asia/Seoul')::date
          >= (now() at time zone 'Asia/Seoul')::date - make_interval(days => v_days - 1)
    group by 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', to_char(s.d, 'YYYY-MM-DD'),
      'claudeCostUsd', round(coalesce(a.claude_cost, 0)::numeric, 6),
      'gptInTok', coalesce(a.gpt_in, 0),
      'gptOutTok', coalesce(a.gpt_out, 0),
      'sessions', coalesce(a.sessions, 0)
    ) order by s.d
  ), '[]'::jsonb)
  into result
  from series s
  left join agg a on a.d = s.d;

  return jsonb_build_object('days', result);
end; $$;
