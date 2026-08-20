import 'server-only';
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

export function getSupabaseTelemetrySecret() {
  const secret = process.env.CHARACTER2_TELEMETRY_SECRET?.trim();
  if (!secret) throw new Error('CHARACTER2_TELEMETRY_SECRET_MISSING');
  return secret;
}
