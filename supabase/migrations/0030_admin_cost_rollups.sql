-- Accurate per-character cost rollups for the admin console.
-- Every AI usage event stays cumulative, so deleting/regenerating a report adds
-- the new generation spend instead of replacing the previous spend.
-- OpenAI is estimated from tokens in the client; exclude any gateway cost_usd
-- that may now be present on OpenAI events to avoid double-counting it.

create or replace function public.character2_admin_cost_rollups(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare result jsonb;
begin
  if not public.character2_admin_session_ok(p_token) then
    raise exception 'ADMIN_AUTH_INVALID';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shareCode', c.share_code,
    'summaryCostUsd', coalesce(u.summary_cost_usd, 0),
    'detailCostUsd', coalesce(u.detail_cost_usd, 0),
    'summaryGptInTok', coalesce(u.summary_gpt_in_tok, 0),
    'summaryGptOutTok', coalesce(u.summary_gpt_out_tok, 0),
    'detailGptInTok', coalesce(u.detail_gpt_in_tok, 0),
    'detailGptOutTok', coalesce(u.detail_gpt_out_tok, 0),
    'usageUpdatedAt', u.usage_updated_at
  ) order by c.created_at desc), '[]'::jsonb)
  into result
  from public.character2_characters c
  left join lateral (
    select
      round(coalesce(sum(case
        when e.stage like 'summary%'
          and e.model not like 'openai/%'
        then coalesce(e.cost_usd, 0)
        else 0
      end), 0)::numeric, 6) as summary_cost_usd,
      round(coalesce(sum(case
        when e.stage like 'detail%'
          and e.model not like 'openai/%'
        then coalesce(e.cost_usd, 0)
        else 0
      end), 0)::numeric, 6) as detail_cost_usd,
      coalesce(sum(case
        when e.model like 'openai/%'
          and (e.stage like 'profile%' or e.stage like 'questions%' or e.stage like 'summary%' or e.stage like 'personality%')
        then e.input_tokens else 0 end
      ), 0)::bigint as summary_gpt_in_tok,
      coalesce(sum(case
        when e.model like 'openai/%'
          and (e.stage like 'profile%' or e.stage like 'questions%' or e.stage like 'summary%' or e.stage like 'personality%')
        then e.output_tokens else 0 end
      ), 0)::bigint as summary_gpt_out_tok,
      coalesce(sum(case
        when e.model like 'openai/%' and e.stage like 'detail%'
        then e.input_tokens else 0 end
      ), 0)::bigint as detail_gpt_in_tok,
      coalesce(sum(case
        when e.model like 'openai/%' and e.stage like 'detail%'
        then e.output_tokens else 0 end
      ), 0)::bigint as detail_gpt_out_tok,
      max(e.created_at) as usage_updated_at
    from public.character2_ai_usage_events e
    where e.share_code = c.share_code
  ) u on true;

  return result;
end; $$;

revoke all on function public.character2_admin_cost_rollups(text) from public;
grant execute on function public.character2_admin_cost_rollups(text) to anon;
