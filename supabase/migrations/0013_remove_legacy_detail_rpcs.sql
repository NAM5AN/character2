-- Remove superseded paid-detail RPCs from migrations 0003, 0005, 0010 and 0011.
-- All reads and writes now require a per-character detail view token or creator edit token.

drop function if exists public.character2_get_saved_detail(text);
drop function if exists public.character2_get_saved_detail_bundle(text);
drop function if exists public.character2_save_saved_detail(text,jsonb);
drop function if exists public.character2_get_detail_bundle(text,text);
drop function if exists public.character2_save_detail(text,text,jsonb);
drop function if exists public.character2_get_detail_source(text,text,text);
