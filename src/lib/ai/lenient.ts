import { z } from 'zod';

// AI가 구조는 맞게 이해했지만 타입만 틀리게 뱉는 경우(배열 자리에 문자열, 객체 자리에
// JSON 문자열 등)를 재생성 없이 흡수한다. 프롬프트를 통째로 다시 보내는 재시도는
// 비용이 두 배가 되므로, 내용이 살아 있는 응답은 여기서 정규화해서 통과시킨다.
//
// 원칙: 없는 내용을 지어내지 않는다. 담긴 값을 옮겨 담기만 한다.

function parseJsonish(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // 코드펜스로 감싼 JSON을 그대로 뱉는 경우가 있다.
  const unfenced = trimmed.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  if (!/^[[{]/u.test(unfenced)) return undefined;
  try { return JSON.parse(unfenced) } catch { return undefined }
}

// 문자열을 항목 배열로 편다. 줄바꿈 → 글머리표 → 세미콜론 순으로만 나누고,
// 마침표로는 나누지 않는다(한 항목 안의 문장을 쪼개면 뜻이 망가진다).
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => toStringArray(item));
  }
  if (typeof value === 'string') {
    const parsed = parseJsonish(value);
    if (parsed !== undefined && typeof parsed !== 'string') return toStringArray(parsed);
    const lines = value
      .replace(/\r\n?/gu, '\n')
      .split(/\n+/u)
      .flatMap(line => (line.includes(';') && !line.includes('。') ? line.split(';') : [line]))
      .map(line => line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/u, '').replace(/\s+/gu, ' ').trim())
      .filter(Boolean);
    return lines.length ? lines : [];
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(item => toStringArray(item));
  }
  if (value === null || value === undefined) return [];
  return [String(value).trim()].filter(Boolean);
}

// 배열을 기대하는 자리에 문자열/객체가 와도 살려낸다.
// (preprocess 가 타입을 넓히지 않도록 원 스키마 타입을 유지한다)
export function lenientStringArray<T extends z.ZodTypeAny>(inner: T): T {
  return z.preprocess(value => {
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value;
    if (value === undefined || value === null) return value;
    const list = toStringArray(value);
    return list.length ? list : value;
  }, inner) as unknown as T;
}

// 배열 자리에 온 값을 살려낸다(객체 배열용). 단일 객체가 오면 1개짜리 배열로,
// JSON 문자열이면 파싱해서 배열로 만든다.
// z.preprocess 는 출력 타입을 unknown 으로 넓히므로, 원래 스키마의 타입을 그대로
// 유지하도록 결과를 다시 캐스팅한다(런타임 동작은 동일).
export function lenientArray<T extends z.ZodTypeAny>(inner: T): T {
  return z.preprocess(value => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const parsed = parseJsonish(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
      return value;
    }
    if (value && typeof value === 'object') return [value];
    return value;
  }, inner) as unknown as T;
}
