import { headers } from 'next/headers';
import { getSupabaseServer } from '@/lib/supabase/server';
import { sha256 } from '@/lib/crypto';

// 로컬 백스톱. DB 기반 제한이 실패했을 때만 쓰는 인메모리 카운터입니다.
// 서버 인스턴스마다 따로 세므로 정확하진 않지만, DB 장애 중에 한 인스턴스가 무제한으로
// 두들겨 맞는 것은 막습니다. 오래된 항목은 접근할 때 정리합니다.
const localHits = new Map<string, number[]>();

function localRateLimitExceeded(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const recent = (localHits.get(key) ?? []).filter(t => now - t < windowMs);
  recent.push(now);
  localHits.set(key, recent);
  if (localHits.size > 5_000) {
    for (const [k, v] of localHits) if (!v.some(t => now - t < windowMs)) localHits.delete(k);
  }
  return recent.length > limit;
}

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
    // DB 제한이 동작하지 않을 때 예전에는 그냥 통과시켰습니다(fail open). 그러면 Supabase
    // 장애가 곧 "제한 없음"이 되어, 비용이 드는 AI 라우트가 무방비로 열립니다.
    // 사이트를 통째로 막지는 않되, 인메모리 백스톱으로 한 번 더 거릅니다.
    console.warn('RATE_LIMIT_DB_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    if (localRateLimitExceeded(`${action}:${ipHash}`, limit, windowMinutes * 60_000)) {
      throw new Error('RATE_LIMITED');
    }
  }
}
