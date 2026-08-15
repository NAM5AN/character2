import { generateText } from 'ai';
import { z } from 'zod';

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(unfenced); } catch {}
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
  throw new Error('AI_JSON_PARSE_FAILED');
}

function validateJson<T>(text: string, schema: z.ZodType<T>) {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : 'AI_JSON_PARSE_FAILED' };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true as const, data: result.data };
  const reason = result.error.issues
    .slice(0, 12)
    .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false as const, reason };
}

export async function generateValidatedJson<T>(args: {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<T> {
  const strictSystem = `${args.system}\n\n응답 규칙:\n- 반드시 유효한 JSON 객체 하나만 출력하세요.\n- 마크다운 코드블록, 설명문, 머리말, 꼬리말을 붙이지 마세요.\n- 모든 필수 키를 빠짐없이 포함하세요.\n- 숫자/불리언/배열/객체 타입을 임의로 문자열로 바꾸지 마세요.`;

  const first = await generateText({
    model: args.model,
    system: strictSystem,
    prompt: args.prompt,
    maxOutputTokens: args.maxOutputTokens,
  });
  const firstResult = validateJson(first.text, args.schema);
  if (firstResult.ok) return firstResult.data;

  const repair = await generateText({
    model: args.model,
    system: strictSystem,
    prompt: `${args.prompt}\n\n직전 응답은 JSON 검증에 실패했습니다. 아래 문제를 모두 고쳐 처음부터 JSON 객체 하나만 다시 출력하세요.\n검증 오류: ${firstResult.reason}\n\n직전 응답:\n${first.text || '(빈 응답)'}`,
    maxOutputTokens: args.maxOutputTokens,
  });
  const repairResult = validateJson(repair.text, args.schema);
  if (repairResult.ok) return repairResult.data;

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${repairResult.reason}`);
}
