import { z } from 'zod';
import { extractJsonObject } from '@/lib/ai/json';

function outputText(body: any): string {
  if (typeof body?.output_text === 'string') return body.output_text;
  const chunks: string[] = [];
  for (const item of body?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

export async function askOpenAIJson<T>(args: {
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_NOT_CONFIGURED');
  const model = process.env.OPENAI_MODEL || 'gpt-5.6';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: `${args.instructions}\n\n반드시 JSON 객체 하나만 출력하세요. 마크다운 코드펜스와 설명문을 붙이지 마세요.`,
      input: args.input,
      max_output_tokens: args.maxOutputTokens ?? 3500,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`OPENAI_ERROR:${body?.error?.message || response.status}`);
  const parsed = extractJsonObject(outputText(body));
  const result = args.schema.safeParse(parsed);
  if (!result.success) throw new Error(`OPENAI_SCHEMA_INVALID:${result.error.message}`);
  return result.data;
}
