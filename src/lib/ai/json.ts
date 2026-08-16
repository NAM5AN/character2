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
  maxAttempts?: number;
}): Promise<T> {
  const strictSystem = `${args.system}\n\n응답 규칙:\n- 반드시 유효한 JSON 객체 하나만 출력하세요.\n- 마크다운 코드블록, 설명문, 머리말, 꼬리말을 붙이지 마세요.\n- 모든 필수 키를 빠짐없이 포함하세요.\n- 숫자/불리언/배열/객체 타입을 임의로 문자열로 바꾸지 마세요.\n- 문자열 안의 따옴표, 역슬래시, 줄바꿈 같은 제어문자는 반드시 JSON 규칙에 맞게 escape 하세요.\n- 불필요하게 긴 문장을 쓰지 말고 각 값은 간결하게 작성하세요.`;

  let lastReason = 'AI_JSON_VALIDATION_FAILED';
  const maxAttempts = Math.max(1, Math.min(args.maxAttempts ?? 3, 3));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryNote = attempt === 0
      ? ''
      : `\n\n이전 생성은 JSON 검증에 실패했습니다. 이전 출력을 복사하거나 수리하려 하지 말고 원본 입력만 보고 처음부터 새 JSON을 생성하세요. 검증 실패 원인: ${lastReason}. 특히 쉼표, 대괄호, 중괄호, 문자열 escape를 엄격히 확인하세요.`;

    const response = await generateText({
      model: args.model,
      system: strictSystem,
      prompt: `${args.prompt}${retryNote}`,
      maxOutputTokens: args.maxOutputTokens,
    });
    const result = validateJson(response.text, args.schema);
    if (result.ok) return result.data;
    lastReason = result.reason;
  }

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason}`);
}
