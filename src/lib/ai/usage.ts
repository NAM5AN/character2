import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { after } from 'next/server';
import { gateway } from 'ai';
import { getSupabaseServer, getSupabaseTelemetrySecret } from '@/lib/supabase/server';

export type AiUsageContext = {
  sessionId?: string;
  shareCode?: string;
  characterName?: string;
  stage: string;
};

export type AiAttemptRef = {
  attemptId: string;
  operationId: string;
  operationSequence: number;
  localAttempt: number;
  model: string;
};

type AiUsageState = AiUsageContext & {
  operationId: string;
  nextAttemptSequence: number;
  lastAttempt?: AiAttemptRef;
};

type AiAttemptOutcome = 'accepted' | 'retried' | 'failed';

type UnknownRecord = Record<string, unknown>;

const usageStore = new AsyncLocalStorage<AiUsageState>();

// Runs `work` inside the usage context and, if it throws, records the failure to
// character2_gen_failures before re-throwing. Every AI generation call is wrapped in
// this, so it is the single place that sees which stage/character a failure belongs to.
// (streamOpenAIJson/askOpenAIJson already retry + fall back internally, so a throw here
// means the whole stage genuinely failed — one row per real user-facing drop-off.)
export function withAiUsageContext<T>(context: AiUsageContext, work: () => Promise<T>): Promise<T> {
  const state: AiUsageState = {
    ...context,
    operationId: crypto.randomUUID(),
    nextAttemptSequence: 0,
  };
  return usageStore.run(state, async () => {
    // Heartbeat: record an in-flight row so a hard process death (300s timeout, OOM)
    // — which never runs our catch/finally in a way that reaches the DB after the kill —
    // still leaves a trace. The row is cleared below on success or caught failure; only
    // a killed process leaves it behind for the admin console to flag.
    const inflightId = await beginInflight(context);
    try {
      return await work();
    } catch (error) {
      scheduleGenFailureRecord(state, error);
      throw error;
    } finally {
      await endInflight(inflightId);
    }
  });
}

// Insert an in-flight heartbeat row; returns its id (or null if the write failed).
// Awaited before work starts so a fast completion cannot race ahead of the insert.
async function beginInflight(context: AiUsageContext): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    const sb = getSupabaseServer();
    const { error } = await sb.rpc('character2_gen_inflight_begin', {
      p_id: id,
      p_stage: context.stage,
      p_share_code: context.shareCode?.trim() || null,
      p_session_id: safeUuid(context.sessionId),
      p_character_name: context.characterName?.trim() || null,
      p_telemetry_secret: getSupabaseTelemetrySecret(),
    });
    if (error) throw error;
    return id;
  } catch (error) {
    console.warn('GEN_INFLIGHT_BEGIN_FAILED', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// Clear the heartbeat row. Best-effort — a rare failure here only risks a false
// "stuck" entry, which ages out on its own.
async function endInflight(id: string | null) {
  if (!id) return;
  try {
    const sb = getSupabaseServer();
    const { error } = await sb.rpc('character2_gen_inflight_end', {
      p_id: id,
      p_telemetry_secret: getSupabaseTelemetrySecret(),
    });
    if (error) throw error;
  } catch (error) {
    console.warn('GEN_INFLIGHT_END_FAILED', error instanceof Error ? error.message : String(error));
  }
}

// Split "CODE: detail" into a short error code + detail, mirroring lib/http structuredError.
function splitErrorMessage(message: string) {
  const colon = message.indexOf(':');
  const rawCode = (colon >= 0 ? message.slice(0, colon) : message).trim();
  const code = /^[A-Z0-9_./-]{2,80}$/.test(rawCode) ? rawCode : 'SERVER_ERROR';
  const detail = (colon >= 0 ? message.slice(colon + 1) : code === 'SERVER_ERROR' ? message : '').trim();
  return { code, detail };
}

function operationContext(state: AiUsageState) {
  return {
    sessionId: state.sessionId,
    shareCode: state.shareCode,
    characterName: state.characterName,
    stage: state.stage,
    operationId: state.operationId,
  };
}

function attemptFromUnknown(value: unknown): AiAttemptRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const attempt = (value as { aiAttempt?: unknown }).aiAttempt;
  if (!attempt || typeof attempt !== 'object') return undefined;
  const item = attempt as Partial<AiAttemptRef>;
  return typeof item.attemptId === 'string'
    && typeof item.operationId === 'string'
    && typeof item.operationSequence === 'number'
    && typeof item.localAttempt === 'number'
    && typeof item.model === 'string'
    ? item as AiAttemptRef
    : undefined;
}

async function writeGenFailure(args: {
  context: ReturnType<typeof operationContext>;
  code: string;
  detail: string;
  kind?: 'failure' | 'retry';
  attempt?: AiAttemptRef;
}) {
  try {
    const sb = getSupabaseServer();
    const { error } = await sb.rpc('character2_log_gen_failure', {
      p_stage: args.context.stage,
      p_share_code: args.context.shareCode?.trim() || null,
      p_session_id: safeUuid(args.context.sessionId),
      p_error_code: args.code,
      p_error_detail: args.detail || null,
      p_kind: args.kind || 'failure',
      p_character_name: args.context.characterName?.trim() || null,
      p_operation_id: args.context.operationId,
      p_attempt_id: args.attempt?.attemptId || null,
      p_model: args.attempt?.model || null,
      p_telemetry_secret: getSupabaseTelemetrySecret(),
    });
    if (error) throw error;
  } catch (error) {
    console.warn('GEN_FAILURE_DB_WRITE_FAILED', error instanceof Error ? error.message : String(error));
  }
}

// Record an attempt that failed but was retried. Retries silently re-send the whole
// prompt, so they cost as much as the original call — logging why one happened is the
// only way to find the recurring rule violations worth fixing at the prompt level.
// Best-effort and never blocks or throws; a no-op outside an AI usage context.
export function logGenRetry(code: string, detail: string, attempt?: AiAttemptRef) {
  const state = usageStore.getStore();
  if (!state) return;
  const target = attempt ?? state.lastAttempt;
  const snapshot = {
    context: operationContext(state),
    code,
    detail: detail.slice(0, 2000),
    kind: 'retry' as const,
    attempt: target,
  };
  try {
    after(async () => {
      await Promise.all([
        writeGenFailure(snapshot),
        target ? writeAttempt({
          context: snapshot.context,
          attempt: target,
          outcome: 'retried',
          errorCode: code,
          errorDetail: detail,
          hasUsage: false,
        }) : Promise.resolve(),
      ]);
    });
  } catch {
    void Promise.all([
      writeGenFailure(snapshot),
      target ? writeAttempt({
        context: snapshot.context,
        attempt: target,
        outcome: 'retried',
        errorCode: code,
        errorDetail: detail,
        hasUsage: false,
      }) : Promise.resolve(),
    ]);
  }
}

// Best-effort: schedule the failure write after the response, never block or throw.
function scheduleGenFailureRecord(state: AiUsageState, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const { code, detail } = splitErrorMessage(message);
  const snapshot = {
    context: operationContext(state),
    code,
    detail,
    attempt: attemptFromUnknown(error) ?? state.lastAttempt,
  };
  try {
    after(async () => { await writeGenFailure(snapshot); });
  } catch {
    // after() unavailable in this context — fall back to a detached write.
    void writeGenFailure(snapshot);
  }
}

export function currentAiUsageContext() {
  return usageStore.getStore();
}

export function beginAiAttempt(model: string, localAttempt: number): AiAttemptRef | undefined {
  const state = usageStore.getStore();
  if (!state) return undefined;
  const attempt: AiAttemptRef = {
    attemptId: crypto.randomUUID(),
    operationId: state.operationId,
    operationSequence: state.nextAttemptSequence + 1,
    localAttempt,
    model,
  };
  state.nextAttemptSequence = attempt.operationSequence;
  state.lastAttempt = attempt;
  return attempt;
}

export function aiAttemptFromError(error: unknown): AiAttemptRef | undefined {
  return attemptFromUnknown(error);
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

async function writeAttempt(args: {
  context: ReturnType<typeof operationContext>;
  attempt: AiAttemptRef;
  outcome: AiAttemptOutcome;
  errorCode?: string;
  errorDetail?: string;
  hasUsage: boolean;
  generationId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  finishReason?: string;
}) {
  let inputTokens=args.inputTokens ?? 0;
  let outputTokens=args.outputTokens ?? 0;
  let totalTokens=args.totalTokens ?? 0;
  let costUsd:number|null=null;
  let latencyMs:number|null=null;
  let finishReason=args.finishReason ?? '';

  if(args.hasUsage&&args.generationId){
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
    const {error}=await sb.rpc('character2_log_ai_attempt',{
      p_attempt_id:args.attempt.attemptId,
      p_operation_id:args.attempt.operationId,
      p_operation_sequence:args.attempt.operationSequence,
      p_usage_session_id:safeUuid(args.context.sessionId),
      p_share_code:args.context.shareCode?.trim()||null,
      p_character_name:args.context.characterName?.trim()||null,
      p_stage:args.context.stage,
      p_model:args.attempt.model,
      p_generation_id:args.generationId||null,
      p_local_attempt:args.attempt.localAttempt,
      p_input_tokens:inputTokens,
      p_output_tokens:outputTokens,
      p_total_tokens:totalTokens,
      p_cost_usd:costUsd,
      p_latency_ms:latencyMs,
      p_finish_reason:finishReason||null,
      p_outcome:args.outcome,
      p_error_code:args.errorCode?.trim()||null,
      p_error_detail:args.errorDetail?.slice(0,2000).trim()||null,
      p_has_usage:args.hasUsage,
      p_telemetry_secret:getSupabaseTelemetrySecret(),
    });
    if(error)throw error;
  }catch(error){
    console.warn('AI_USAGE_DB_WRITE_FAILED',error instanceof Error?error.message:String(error));
  }
}

export function scheduleAiUsageRecord(args:{
  attempt:AiAttemptRef|undefined;
  response?:unknown;
  outcome:AiAttemptOutcome;
  errorCode?:string;
  errorDetail?:string;
  hasUsage?:boolean;
}){
  const state=usageStore.getStore();
  if(!state||!args.attempt)return;
  const response=asRecord(args.response);
  const usage=asRecord(response.usage);
  const providerMetadata=asRecord(response.providerMetadata);
  const gatewayMetadata=asRecord(providerMetadata.gateway);
  const generationId=asText(gatewayMetadata.generationId);
  const inputTokens=asNumber(usage.inputTokens,usage.promptTokens);
  const outputTokens=asNumber(usage.outputTokens,usage.completionTokens);
  const totalTokens=asNumber(usage.totalTokens,inputTokens+outputTokens);
  const finishReason=asText(response.finishReason);
  const snapshot={
    context:operationContext(state),
    attempt:args.attempt,
    outcome:args.outcome,
    errorCode:args.errorCode,
    errorDetail:args.errorDetail,
    hasUsage:args.hasUsage ?? Boolean(args.response),
    generationId,
    inputTokens,
    outputTokens,
    totalTokens,
    finishReason,
  };

  try{
    after(async()=>{await writeAttempt(snapshot)});
  }catch(error){
    console.warn('AI_USAGE_AFTER_SCHEDULE_FAILED',error instanceof Error?error.message:String(error));
    void writeAttempt(snapshot);
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
    const {error}=await sb.rpc('character2_attach_ai_usage_session',{
      p_usage_session_id:id,
      p_share_code:shareCode,
      p_telemetry_secret:getSupabaseTelemetrySecret(),
    });
    if(error)throw error;
  }catch(error){
    console.warn('AI_USAGE_ATTACH_FAILED',error instanceof Error?error.message:String(error));
  }
}
