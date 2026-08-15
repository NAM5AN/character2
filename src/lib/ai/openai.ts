import { z } from 'zod';
import { generateValidatedJson } from '@/lib/ai/json';

export async function askOpenAIJson<T>(args: {
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<T> {
  const model = process.env.OPENAI_MODEL || 'openai/gpt-5.6-luna';
  return generateValidatedJson({
    model,
    system: args.instructions,
    prompt: args.input,
    schema: args.schema,
    maxOutputTokens: args.maxOutputTokens,
  });
}
