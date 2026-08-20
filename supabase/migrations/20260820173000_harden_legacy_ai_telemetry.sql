-- Once the secret-protected writers are deployed, remove the legacy anonymous
-- telemetry surface. Core character/report RPCs are not affected.

revoke execute on function public.character2_log_gen_failure(text,text,uuid,text,text) from anon, authenticated;
revoke execute on function public.character2_log_gen_failure(text,text,uuid,text,text,text) from anon, authenticated;
revoke execute on function public.character2_gen_inflight_begin(uuid,text,text,uuid) from anon, authenticated;
revoke execute on function public.character2_gen_inflight_end(uuid) from anon, authenticated;
revoke execute on function public.character2_log_ai_usage(uuid,text,text,text,text,integer,bigint,bigint,bigint,numeric,integer,text) from anon, authenticated;
revoke execute on function public.character2_attach_ai_usage_session(uuid,text) from anon, authenticated;
