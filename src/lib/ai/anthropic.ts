import { z } from 'zod';
import { extractJsonObject } from '@/lib/ai/json';

export async function askClaudeJson<T>(args: {
  system: string;
  input: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_NOT_CONFIGURED');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: args.maxTokens ?? 3000,
      system: `${args.system}\n반드시 JSON 객체 하나만 출력하세요. 마크다운 코드펜스와 설명문은 출력하지 마세요.`,
      messages: [{ role: 'user', content: args.input }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`ANTHROPIC_ERROR:${body?.error?.message || response.status}`);
  const text = (body?.content ?? []).filter((x: any) => x?.type === 'text').map((x: any) => x.text).join('\n');
  const parsed = extractJsonObject(text);
  const result = args.schema.safeParse(parsed);
  if (!result.success) throw new Error(`ANTHROPIC_SCHEMA_INVALID:${result.error.message}`);
  return result.data;
}
