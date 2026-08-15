import { headers } from 'next/headers';
import { getSupabaseServer } from '@/lib/supabase/server';
import { sha256 } from '@/lib/crypto';

export async function assertRateLimit(action: string, limit = 30, windowMinutes = 10) {
  const h = await headers();
  const rawIp = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  const ipHash = sha256(`${process.env.RATE_LIMIT_SALT || 'character2-v1'}:${rawIp}`);

  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_rate_limit_check', {
      p_ip_hash: ipHash,
      p_action: action,
      p_limit: limit,
      p_window_minutes: windowMinutes,
    });
    if (error) throw error;
    if (data !== true) throw new Error('RATE_LIMITED');
  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMITED') throw error;
    // Rate limiting is best-effort. A temporary Supabase error must not take the site offline.
  }
}
