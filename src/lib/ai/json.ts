import { generateText, streamText, tool } from 'ai';
import { z } from 'zod';
import { aiGatewayUsageOptions, logGenRetry, scheduleAiUsageRecord } from '@/lib/ai/usage';

function imageFilePart(dataUrl:string){
  const match=dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/iu);
  if(!match)throw new Error('AI_IMAGE_INPUT_INVALID');
  return {
    type:'file' as const,
    data:Buffer.from(match[2],'base64'),
    mediaType:match[1],
  };
}

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
  // 출력이 상한에 걸려 잘리면(finishReason 'length') 도구 호출 JSON이 미완성이라 반드시 검증에 실패한다.
  // 같은 상한으로 다시 시도하면 똑같이 잘려서 성공할 수 없으므로, 그 경우에만 상한을 올려 재시도한다.
  // 상한을 낮추는 일은 없으므로 정상 성공 경로의 출력은 달라지지 않는다.
  let outputCap = args.maxOutputTokens;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryNote = attempt === 0
      ? ''
      : `\n\n이전 생성은 구조 검증에 실패했습니다. 이전 출력을 복사하거나 수리하려 하지 말고 원본 입력만 보고 처음부터 다시 작성하세요. 실패 원인: ${lastReason}`;
    const prompt = `${args.prompt}${retryNote}`;
    const providerOptions=aiGatewayUsageOptions();

    let truncated = false;
    try {
      const response = await generateText({
        model: args.model,
        system: strictSystem,
        ...(images.length ? {
          messages: [{
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: prompt },
              ...images.map(imageFilePart),
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
        ...(providerOptions?{providerOptions}:{}),
        ...(typeof outputCap === 'number' ? { maxOutputTokens: outputCap } : {}),
      });

      truncated = response.finishReason === 'length';
      scheduleAiUsageRecord({model:args.model,attempt:attempt+1,response});
      const call = response.toolCalls.find(item => item.toolName === 'submit_result');
      if (!call) throw new Error('AI_TOOL_RESULT_MISSING');
      return args.schema.parse(call.input);
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
      if (attempt + 1 < maxAttempts) logGenRetry(truncated ? 'RETRY_TRUNCATED' : 'RETRY_SCHEMA', lastReason);
      if (truncated && typeof outputCap === 'number') outputCap = Math.min(Math.round(outputCap * 1.6), 16000);
    }
  }

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason}`);
}

function deltaText(part:unknown):string{
  const p=part as Record<string,unknown>;
  const candidate=p.delta ?? p.textDelta ?? p.inputTextDelta ?? p.argsTextDelta;
  return typeof candidate==='string'?candidate:'';
}

// Streaming variant of generateValidatedJson: same tool-call structured output and
// retry/model semantics, but reports real generation progress (0..1) as the model
// streams the JSON. If the streaming mechanism itself is unavailable, it falls back
// to the proven non-streaming path so the result never regresses; only content
// (schema) failures bubble up as AI_JSON_SCHEMA_FAILED so the caller can switch model.
export async function streamValidatedJson<T>(args: {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  maxAttempts?: number;
  images?: string[];
  onProgress?: (ratio: number) => void;
}): Promise<T> {
  const strictSystem = `${args.system}\n\n응답 규칙:\n- 최종 응답은 반드시 submit_result 도구를 한 번 호출해서 제출하세요.\n- 지정된 구조의 모든 필수 값을 빠짐없이 채우세요.\n- 숫자/불리언/배열/객체 타입을 임의로 문자열로 바꾸지 마세요.\n- 불필요하게 긴 문장이나 항목을 늘리지 말고, 요구된 최소 개수에 가깝게 간결하게 작성하세요.`;

  const images = (args.images ?? []).filter(Boolean);
  const expectedChars = Math.max(1200, (args.maxOutputTokens ?? 2000) * 3);
  const maxAttempts = Math.max(1, Math.min(args.maxAttempts ?? 3, 3));
  let lastReason = 'AI_STRUCTURED_OUTPUT_FAILED';
  // generateValidatedJson과 같은 이유로, 잘린 출력일 때만 상한을 올려 재시도한다.
  let outputCap = args.maxOutputTokens;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryNote = attempt === 0
      ? ''
      : `\n\n이전 생성은 구조 검증에 실패했습니다. 이전 출력을 복사하거나 수리하려 하지 말고 원본 입력만 보고 처음부터 다시 작성하세요. 실패 원인: ${lastReason}`;
    const prompt = `${args.prompt}${retryNote}`;
    const providerOptions = aiGatewayUsageOptions();

    let toolCallInput: unknown;
    let truncated = false;
    try {
      const result = streamText({
        model: args.model,
        system: strictSystem,
        ...(images.length ? {
          messages: [{
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: prompt },
              ...images.map(imageFilePart),
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
        ...(providerOptions ? { providerOptions } : {}),
        ...(typeof outputCap === 'number' ? { maxOutputTokens: outputCap } : {}),
      });

      let acc = 0;
      for await (const part of result.fullStream) {
        if ((part as { type?: string }).type === 'error') {
          throw (part as { error?: unknown }).error ?? new Error('AI_STREAM_ERROR');
        }
        const chunk = deltaText(part);
        if (chunk) {
          acc += chunk.length;
          args.onProgress?.(Math.min(0.97, acc / expectedChars));
        }
      }

      truncated = (await result.finishReason) === 'length';
      const calls = await result.toolCalls;
      const call = calls.find(item => item.toolName === 'submit_result');
      if (!call) throw new Error('AI_TOOL_RESULT_MISSING');
      try {
        scheduleAiUsageRecord({
          model: args.model,
          attempt: attempt + 1,
          response: {
            usage: await result.usage,
            providerMetadata: await result.providerMetadata,
            finishReason: await result.finishReason,
          },
        });
      } catch { /* usage telemetry is best-effort */ }
      toolCallInput = (call as { input: unknown }).input;
    } catch (streamError) {
      // The streaming mechanism failed (not a content/schema problem). Never regress:
      // fall back to the proven non-streaming generator for this model.
      void streamError;
      return generateValidatedJson({
        model: args.model,
        system: args.system,
        prompt: args.prompt,
        schema: args.schema,
        maxOutputTokens: args.maxOutputTokens,
        images: args.images,
      });
    }

    const parsed = args.schema.safeParse(toolCallInput);
    if (parsed.success) {
      args.onProgress?.(1);
      return parsed.data;
    }
    lastReason = parsed.error.message;
    if (attempt + 1 < maxAttempts) logGenRetry(truncated ? 'RETRY_TRUNCATED' : 'RETRY_SCHEMA', lastReason);
    if (truncated && typeof outputCap === 'number') outputCap = Math.min(Math.round(outputCap * 1.6), 16000);
  }

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason}`);
}
