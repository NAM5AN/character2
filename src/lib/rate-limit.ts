import { headers } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { sha256 } from '@/lib/crypto';

export async function assertRateLimit(action: string, limit = 30, windowMinutes = 10) {
  const h = await headers();
  const rawIp = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  const ipHash = sha256(`${process.env.RATE_LIMIT_SALT || 'dev'}:${rawIp}`);
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await supabase
    .from('rate_limit_events')
    .select('*', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .eq('action', action)
    .gte('created_at', since);
  if (error) throw error;
  if ((count ?? 0) >= limit) throw new Error('RATE_LIMITED');
  await supabase.from('rate_limit_events').insert({ ip_hash: ipHash, action });
}
