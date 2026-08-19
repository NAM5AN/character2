import { z } from 'zod';
import { generateValidatedJson, streamValidatedJson } from '@/lib/ai/json';
import { getCharacterDeepAnalysisSkill } from '@/lib/ai/character-deep-analysis-skill';
import { rewriteDetailedReportParagraphLeads } from '@/lib/ai/report-paragraph-leads';

const DEFAULT_SUMMARY_MODEL = 'anthropic/claude-sonnet-5';
const DEFAULT_DETAIL_MODEL = 'anthropic/claude-opus-4.8';
const DEFAULT_REPORT_MODEL = 'anthropic/claude-sonnet-5';

function isReportWriterSystem(system: string) {
  return system.includes('리포트를 쓰는 분석가') || system.includes('리포트를 쓰는 전문 해석자');
}

function resolveClaudeModel(system: string, explicitModel?: string) {
  if (explicitModel) return explicitModel;
  const isPaidDetail = system.includes('유료 상세 캐해 리포트');
  if (isPaidDetail && isReportWriterSystem(system)) {
    // 6.2+ 상세 리포트는 출력 섹션이 크게 늘어 Opus 한 번으로 작성하면
    // Vercel 300초 실행 제한을 넘길 수 있습니다. 최종 서술은 빠른 Sonnet을 기본으로 사용합니다.
    return process.env.ANTHROPIC_REPORT_MODEL || DEFAULT_REPORT_MODEL;
  }
  if (isPaidDetail) return process.env.ANTHROPIC_DETAIL_MODEL || DEFAULT_DETAIL_MODEL;
  return process.env.ANTHROPIC_SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;
}

function applyCharacterDeepAnalysisSkill(system: string) {
  if (!system.includes('유료 상세 캐해 리포트')) return system;

  const skill = getCharacterDeepAnalysisSkill();
  const isReportWriter = isReportWriterSystem(system);

  if (isReportWriter) {
    return [
      skill.reportGuide,
      '# 현재 호출의 세부 역할',
      system,
    ].join('\n\n---\n\n');
  }

  return [
    skill.analysisGuide,
    skill.qualityExamples,
    '# 현재 호출의 세부 역할',
    system,
  ].join('\n\n---\n\n');
}

async function finalizeClaudeResult<T>(value: T, system: string, model: string, skip?: boolean) {
  if (skip || !isReportWriterSystem(system)) return value;
  return rewriteDetailedReportParagraphLeads(value, model);
}

// Rewrite paragraph leads for an already-generated report object, using the same model
// askClaudeJson would have used for that system prompt. Lets a caller that produced
// several report stages fold their lead rewrites into a single call instead of one per
// stage — the rewriter already handles every report field in one pass.
export function rewriteReportLeads<T>(value: T, system: string): Promise<T> {
  return rewriteDetailedReportParagraphLeads(value, resolveClaudeModel(system));
}

export async function askClaudeJson<T>(args: {
  system: string;
  input: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  maxAttempts?: number;
  allowFallback?: boolean;
  model?: string;
  // Skip the per-call paragraph-lead rewrite so the caller can batch several stages
  // into one rewrite (see rewriteReportLeads). Leaves output identical either way.
  skipLeadRewrite?: boolean;
}): Promise<T> {
  const primaryModel = resolveClaudeModel(args.system, args.model);
  const resolvedSystem = applyCharacterDeepAnalysisSkill(args.system);
  const isPaidDetail = args.system.includes('유료 상세 캐해 리포트');
  // 상세 리포트는 재시도를 1회로 제한해 300초 타임아웃을 막되,
  // 출력 토큰은 앱에서 임의로 자르지 않습니다. 스키마의 길이 제한이 출력 크기를 제어합니다.
  const maxAttempts = args.maxAttempts ?? (isPaidDetail ? 1 : undefined);
  const maxOutputTokens = isPaidDetail ? undefined : args.maxTokens;

  try {
    const result = await generateValidatedJson({
      model: primaryModel,
      system: resolvedSystem,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens,
      maxAttempts,
    });
    return await finalizeClaudeResult(result, args.system, primaryModel, args.skipLeadRewrite);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('AI_JSON_SCHEMA_FAILED')) throw error;
    if (args.allowFallback === false) throw error;

    const fallbackModel = process.env.CLAUDE_JSON_FALLBACK_MODEL || 'openai/gpt-5.6-luna';
    const result = await generateValidatedJson({
      model: fallbackModel,
      system: `${resolvedSystem}\n\n이 요청은 다른 모델의 JSON 생성 실패 후 재시도입니다. 원본 입력만 근거로 새 JSON을 생성하세요.`,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens,
      maxAttempts,
    });
    return finalizeClaudeResult(result, args.system, fallbackModel, args.skipLeadRewrite);
  }
}

// Streaming variant of askClaudeJson: same model resolution, skill priming and
// fallback behavior, but reports real generation progress via onProgress.
export async function streamClaudeJson<T>(args: {
  system: string;
  input: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  maxAttempts?: number;
  allowFallback?: boolean;
  model?: string;
  onProgress?: (ratio: number) => void;
}): Promise<T> {
  const primaryModel = resolveClaudeModel(args.system, args.model);
  const resolvedSystem = applyCharacterDeepAnalysisSkill(args.system);
  const isPaidDetail = args.system.includes('유료 상세 캐해 리포트');
  const maxAttempts = args.maxAttempts ?? (isPaidDetail ? 1 : undefined);
  const maxOutputTokens = isPaidDetail ? undefined : args.maxTokens;

  try {
    const result = await streamValidatedJson({
      model: primaryModel,
      system: resolvedSystem,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens,
      maxAttempts,
      onProgress: args.onProgress,
    });
    return await finalizeClaudeResult(result, args.system, primaryModel);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('AI_JSON_SCHEMA_FAILED')) throw error;
    if (args.allowFallback === false) throw error;

    const fallbackModel = process.env.CLAUDE_JSON_FALLBACK_MODEL || 'openai/gpt-5.6-luna';
    const result = await streamValidatedJson({
      model: fallbackModel,
      system: `${resolvedSystem}\n\n이 요청은 다른 모델의 JSON 생성 실패 후 재시도입니다. 원본 입력만 근거로 새 JSON을 생성하세요.`,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens,
      maxAttempts,
      onProgress: args.onProgress,
    });
    return finalizeClaudeResult(result, args.system, fallbackModel);
  }
}
