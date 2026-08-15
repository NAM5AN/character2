import { z } from 'zod';
import { generateValidatedJson } from '@/lib/ai/json';

export async function askClaudeJson<T>(args: {
  system: string;
  input: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<T> {
  const model = process.env.ANTHROPIC_MODEL || 'anthropic/claude-sonnet-5';
  return generateValidatedJson({
    model,
    system: args.system,
    prompt: args.input,
    schema: args.schema,
    maxOutputTokens: args.maxTokens,
  });
}
