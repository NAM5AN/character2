import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://kfgtvifupumjuewwxzmz.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KROAv1c1eX3wlEt8Mog8OQ_jNTMJzoM';

export function getSupabaseServer() {
  const url = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
