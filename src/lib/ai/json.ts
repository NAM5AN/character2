import { generateText, Output } from 'ai';
import { z } from 'zod';

export async function generateValidatedJson<T>(args: {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  maxAttempts?: number;
}): Promise<T> {
  const strictSystem = `${args.system}\n\n응답 규칙:\n- 지정된 구조의 모든 필수 값을 빠짐없이 채우세요.\n- 숫자/불리언/배열/객체 타입을 임의로 문자열로 바꾸지 마세요.\n- 불필요하게 긴 문장을 쓰지 말고 각 값은 간결하게 작성하세요.`;

  let lastReason = 'AI_STRUCTURED_OUTPUT_FAILED';
  const maxAttempts = Math.max(1, Math.min(args.maxAttempts ?? 3, 3));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryNote = attempt === 0
      ? ''
      : `\n\n이전 생성은 구조 검증에 실패했습니다. 이전 출력을 복사하거나 수리하려 하지 말고 원본 입력만 보고 처음부터 다시 작성하세요. 실패 원인: ${lastReason}`;

    try {
      const response = await generateText({
        model: args.model,
        system: strictSystem,
        prompt: `${args.prompt}${retryNote}`,
        output: Output.object({ schema: args.schema }),
        ...(typeof args.maxOutputTokens === 'number' ? { maxOutputTokens: args.maxOutputTokens } : {}),
      });
      return args.schema.parse(response.output);
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason}`);
}
