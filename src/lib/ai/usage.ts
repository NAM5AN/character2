import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { after } from 'next/server';
import { gateway } from 'ai';
import { getSupabaseServer } from '@/lib/supabase/server';

export type AiUsageContext = {
  sessionId?: string;
  shareCode?: string;
  stage: string;
};

type UnknownRecord = Record<string, unknown>;

const usageStore = new AsyncLocalStorage<AiUsageContext>();

export function withAiUsageContext<T>(context: AiUsageContext, work: () => T): T {
  return usageStore.run(context, work);
}

export function currentAiUsageContext() {
  return usageStore.getStore();
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  }
  return 0;
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeUuid(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value) ? value : null;
}

async function exactGatewayGeneration(generationId: string) {
  const timeout = new Promise<null>(resolve=>setTimeout(()=>resolve(null),2500));
  try {
    return await Promise.race([
      gateway.getGenerationInfo({ id: generationId }),
      timeout,
    ]);
  } catch {
    return null;
  }
}

async function writeUsage(args: {
  context: AiUsageContext;
  model: string;
  attempt: number;
  generationId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  finishReason: string;
}) {
  let inputTokens=args.inputTokens;
  let outputTokens=args.outputTokens;
  let totalTokens=args.totalTokens;
  let costUsd:number|null=null;
  let latencyMs:number|null=null;
  let finishReason=args.finishReason;

  if(args.generationId){
    const exact=await exactGatewayGeneration(args.generationId);
    if(exact){
      const record=asRecord(exact);
      inputTokens=asNumber(record.promptTokens,inputTokens);
      outputTokens=asNumber(record.completionTokens,outputTokens);
      totalTokens=Math.max(totalTokens,inputTokens+outputTokens);
      if(typeof record.totalCost==='number'&&Number.isFinite(record.totalCost))costUsd=record.totalCost;
      if(typeof record.latency==='number'&&Number.isFinite(record.latency))latencyMs=Math.max(0,Math.round(record.latency));
      finishReason=asText(record.finishReason)||finishReason;
    }
  }

  try{
    const sb=getSupabaseServer();
    await sb.rpc('character2_log_ai_usage',{
      p_usage_session_id:safeUuid(args.context.sessionId),
      p_share_code:args.context.shareCode?.trim()||null,
      p_stage:args.context.stage,
      p_model:args.model,
      p_generation_id:args.generationId||null,
      p_attempt:args.attempt,
      p_input_tokens:inputTokens,
      p_output_tokens:outputTokens,
      p_total_tokens:totalTokens,
      p_cost_usd:costUsd,
      p_latency_ms:latencyMs,
      p_finish_reason:finishReason||null,
    });
  }catch(error){
    console.warn('AI_USAGE_DB_WRITE_FAILED',error instanceof Error?error.message:String(error));
  }
}

export function scheduleAiUsageRecord(args:{model:string;attempt:number;response:unknown}){
  const context=currentAiUsageContext();
  if(!context)return;
  const response=asRecord(args.response);
  const usage=asRecord(response.usage);
  const providerMetadata=asRecord(response.providerMetadata);
  const gatewayMetadata=asRecord(providerMetadata.gateway);
  const generationId=asText(gatewayMetadata.generationId);
  const inputTokens=asNumber(usage.inputTokens,usage.promptTokens);
  const outputTokens=asNumber(usage.outputTokens,usage.completionTokens);
  const totalTokens=asNumber(usage.totalTokens,inputTokens+outputTokens);
  const finishReason=asText(response.finishReason);
  const snapshot={context:{...context},model:args.model,attempt:args.attempt,generationId,inputTokens,outputTokens,totalTokens,finishReason};

  try{
    after(async()=>{await writeUsage(snapshot)});
  }catch(error){
    console.warn('AI_USAGE_AFTER_SCHEDULE_FAILED',error instanceof Error?error.message:String(error));
  }
}

export function aiGatewayUsageOptions(){
  const context=currentAiUsageContext();
  if(!context)return undefined;
  const user=context.sessionId||context.shareCode;
  const tags=['character2',`stage:${context.stage}`,...(context.shareCode?[`share:${context.shareCode}`]:[])];
  // caching:'auto' — 게이트웨이가 Anthropic에 자동으로 cache_control 마커를 붙인다.
  // 상세 리포트처럼 큰 스킬 프롬프트를 연속 재전송/재시도하는 호출에서 입력 토큰 비용을 크게 줄인다.
  // OpenAI는 이미 암묵적 캐싱이라 무효과, 잘못된 값도 요청을 실패시키지 않는다.
  return {gateway:{caching:'auto' as const,...(user?{user}:{}),tags}};
}

export async function attachAiUsageSession(sessionId:string|undefined,shareCode:string){
  const id=safeUuid(sessionId);
  if(!id)return;
  try{
    const sb=getSupabaseServer();
    await sb.rpc('character2_attach_ai_usage_session',{p_usage_session_id:id,p_share_code:shareCode});
  }catch(error){
    console.warn('AI_USAGE_ATTACH_FAILED',error instanceof Error?error.message:String(error));
  }
}
