import { generateText, Output } from 'ai';
import { z } from 'zod';

export async function askOpenAIJson<T>(args: {
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<T> {
  const model = process.env.OPENAI_MODEL || 'openai/gpt-5.6-luna';
  const { output } = await generateText({
    model,
    system: args.instructions,
    prompt: args.input,
    output: Output.object({ schema: args.schema }),
  });
  return args.schema.parse(output);
}
