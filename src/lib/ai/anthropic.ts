import { z } from 'zod';
import { generateValidatedJson } from '@/lib/ai/json';

export async function askClaudeJson<T>(args: {
  system: string;
  input: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  allowFallback?: boolean;
  model?: string;
}): Promise<T> {
  const primaryModel = args.model || process.env.ANTHROPIC_MODEL || 'anthropic/claude-sonnet-5';
  try {
    return await generateValidatedJson({
      model: primaryModel,
      system: args.system,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens: args.maxTokens,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('AI_JSON_SCHEMA_FAILED')) throw error;
    if (args.allowFallback === false) throw error;

    const fallbackModel = process.env.CLAUDE_JSON_FALLBACK_MODEL || 'openai/gpt-5.6-luna';
    return generateValidatedJson({
      model: fallbackModel,
      system: `${args.system}\n\n이 요청은 다른 모델의 JSON 생성 실패 후 재시도입니다. 원본 입력만 근거로 새 JSON을 생성하세요.`,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens: args.maxTokens,
    });
  }
}
