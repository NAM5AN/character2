import { generateText, tool } from 'ai';
import { z } from 'zod';

export async function generateValidatedJson<T>(args: {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  maxAttempts?: number;
  images?: string[];
}): Promise<T> {
  const strictSystem = `${args.system}\n\n응답 규칙:\n- 최종 응답은 반드시 submit_result 도구를 한 번 호출해서 제출하세요.\n- 지정된 구조의 모든 필수 값을 빠짐없이 채우세요.\n- 숫자/불리언/배열/객체 타입을 임의로 문자열로 바꾸지 마세요.\n- 불필요하게 긴 문장이나 항목을 늘리지 말고, 요구된 최소 개수에 가깝게 간결하게 작성하세요.`;

  let lastReason = 'AI_STRUCTURED_OUTPUT_FAILED';
  const maxAttempts = Math.max(1, Math.min(args.maxAttempts ?? 3, 3));
  const images = (args.images ?? []).filter(Boolean);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryNote = attempt === 0
      ? ''
      : `\n\n이전 생성은 구조 검증에 실패했습니다. 이전 출력을 복사하거나 수리하려 하지 말고 원본 입력만 보고 처음부터 다시 작성하세요. 실패 원인: ${lastReason}`;
    const prompt = `${args.prompt}${retryNote}`;

    try {
      const response = await generateText({
        model: args.model,
        system: strictSystem,
        ...(images.length ? {
          messages: [{
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: prompt },
              ...images.map(image => ({ type: 'image' as const, image })),
            ],
          }],
        } : { prompt }),
        tools: {
          submit_result: tool({
            description: '완성된 구조화 결과를 제출합니다. 이 도구만 호출하세요.',
            inputSchema: args.schema,
          }),
        },
        toolChoice: { type: 'tool', toolName: 'submit_result' },
        ...(typeof args.maxOutputTokens === 'number' ? { maxOutputTokens: args.maxOutputTokens } : {}),
      });

      const call = response.toolCalls.find(item => item.toolName === 'submit_result');
      if (!call) throw new Error('AI_TOOL_RESULT_MISSING');
      return args.schema.parse(call.input);
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason}`);
}
