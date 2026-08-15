import { generateText, Output } from 'ai';
import { z } from 'zod';

export async function askClaudeJson<T>(args: {
  system: string;
  input: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<T> {
  const model = process.env.ANTHROPIC_MODEL || 'anthropic/claude-sonnet-5';
  const { output } = await generateText({
    model,
    system: args.system,
    prompt: args.input,
    output: Output.object({ schema: args.schema }),
  });
  return args.schema.parse(output);
}
