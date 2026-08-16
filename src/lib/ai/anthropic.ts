import { z } from 'zod';
import { generateValidatedJson } from '@/lib/ai/json';
import { getCharacterDeepAnalysisSkill } from '@/lib/ai/character-deep-analysis-skill';

const DEFAULT_SUMMARY_MODEL = 'anthropic/claude-sonnet-5';
const DEFAULT_DETAIL_MODEL = 'anthropic/claude-opus-4.8';

function resolveClaudeModel(system: string, explicitModel?: string) {
  if (explicitModel) return explicitModel;
  const isPaidDetail = system.includes('유료 상세 캐해 리포트');
  if (isPaidDetail) return process.env.ANTHROPIC_DETAIL_MODEL || DEFAULT_DETAIL_MODEL;
  return process.env.ANTHROPIC_SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;
}

function applyCharacterDeepAnalysisSkill(system: string) {
  if (!system.includes('유료 상세 캐해 리포트')) return system;

  const skill = getCharacterDeepAnalysisSkill();
  const isReportWriter = system.includes('리포트를 쓰는 분석가');
  const guide = isReportWriter ? skill.reportGuide : skill.analysisGuide;

  return [
    guide,
    skill.qualityExamples,
    '# 현재 호출의 세부 역할',
    system,
  ].join('\n\n---\n\n');
}

export async function askClaudeJson<T>(args: {
  system: string;
  input: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  maxAttempts?: number;
  allowFallback?: boolean;
  model?: string;
}): Promise<T> {
  const primaryModel = resolveClaudeModel(args.system, args.model);
  const resolvedSystem = applyCharacterDeepAnalysisSkill(args.system);
  try {
    return await generateValidatedJson({
      model: primaryModel,
      system: resolvedSystem,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens: args.maxTokens,
      maxAttempts: args.maxAttempts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('AI_JSON_SCHEMA_FAILED')) throw error;
    if (args.allowFallback === false) throw error;

    const fallbackModel = process.env.CLAUDE_JSON_FALLBACK_MODEL || 'openai/gpt-5.6-luna';
    return generateValidatedJson({
      model: fallbackModel,
      system: `${resolvedSystem}\n\n이 요청은 다른 모델의 JSON 생성 실패 후 재시도입니다. 원본 입력만 근거로 새 JSON을 생성하세요.`,
      prompt: args.input,
      schema: args.schema,
      maxOutputTokens: args.maxTokens,
      maxAttempts: args.maxAttempts,
    });
  }
}
