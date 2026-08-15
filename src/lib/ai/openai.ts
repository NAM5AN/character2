import { z } from 'zod';
import { generateValidatedJson } from '@/lib/ai/json';

export async function askOpenAIJson<T>(args: {
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<T> {
  const primaryModel = process.env.OPENAI_MODEL || 'openai/gpt-5.6-luna';
  try {
    return await generateValidatedJson({
      model: primaryModel,
      system: args.instructions,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens: args.maxOutputTokens,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('AI_JSON_SCHEMA_FAILED')) throw error;

    const fallbackModel = process.env.OPENAI_JSON_FALLBACK_MODEL || 'anthropic/claude-sonnet-5';
    return generateValidatedJson({
      model: fallbackModel,
      system: `${args.instructions}\n\n이 요청은 다른 모델의 JSON 생성 실패 후 재시도입니다. 원본 입력만 근거로 새 JSON을 생성하세요.`,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens: args.maxOutputTokens,
    });
  }
}
