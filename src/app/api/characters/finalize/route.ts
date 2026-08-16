import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  characterDraftSchema,
  summaryAnalysisGenerationSchema,
  summaryAnalysisRawSchema,
  interviewAnswerSchema,
  characterPassportSchema,
  type SummaryAnalysisGeneration,
} from '@/lib/schemas/character';
import { askClaudeJson } from '@/lib/ai/anthropic';
import { assertRateLimit } from '@/lib/rate-limit';
import { generateShareCode } from '@/lib/share-code';
import { createEditToken, sha256 } from '@/lib/crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { buildCharacterReportPreview } from '@/lib/character-report';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  draft: characterDraftSchema,
  answers: z.array(interviewAnswerSchema).length(20),
});

type UnknownRecord = Record<string, unknown>;

const SUMMARY_SYSTEM = `당신은 자캐커뮤니티 캐릭터를 정밀하게 읽는 분석가입니다.
이번 단계에서는 결제 전 공개할 짧은 요약과, 결제 후 상세 리포트 생성에 사용할 내부 분석 씨앗만 만듭니다.
긴 상세 리포트, 긴 유형별 원문, 항목별 완성 리포트는 절대 미리 작성하지 마세요.
입력된 프로필, 오너가 검수한 AI 추론, 20문항 답변과 이유만 근거로 하며 없는 설정을 만들지 마세요.
오너의 직접 정정과 답변 이유는 AI 추론보다 우선합니다.
analysisSeeds는 상세 생성용 내부 메모입니다. 비밀 프로필 원문이나 문장을 그대로 복사하지 말고, 행동 규칙·관계 패턴·예외 조건·모순·중요한 숨은 맥락을 짧게 압축하세요.`;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (value && typeof value === 'object') return Object.values(value as UnknownRecord).map(asText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return value == null ? '' : String(value).trim();
}

function clipText(text: string, max: number) {
  const normalized=text.replace(/\s+/g,' ').trim();
  if(normalized.length<=max)return normalized;
  const cut=normalized.slice(0,max).trimEnd();
  const stops=[cut.lastIndexOf('.'),cut.lastIndexOf('!'),cut.lastIndexOf('?')];
  const stop=Math.max(...stops);
  return (stop>=Math.floor(max*.62)?cut.slice(0,stop+1):cut).trim();
}

function normalizeSeeds(value: unknown) {
  const raw=Array.isArray(value) ? value : typeof value==='string' ? value.split(/\n+/) : [];
  return [...new Set(raw.map(asText).map(x=>clipText(x,140)).filter(x=>x.length>=20))].slice(0,10);
}

function normalizeSummary(raw: z.infer<typeof summaryAnalysisRawSchema>) {
  const summary=asRecord(raw.summary);
  return {
    oneLineSummary: clipText(asText(raw.oneLineSummary),80),
    summary: {
      outerSelf: clipText(asText(summary.outerSelf),160),
      innerSelf: clipText(asText(summary.innerSelf),160),
      conflictStyle: clipText(asText(summary.conflictStyle),160),
      affectionStyle: clipText(asText(summary.affectionStyle),160),
    },
    analysisSeeds: normalizeSeeds(raw.analysisSeeds),
  };
}

function validationReason(error: z.ZodError) {
  return error.issues.slice(0,12).map(issue=>`${issue.path.join('.')||'(root)'}: ${issue.message}`).join('; ');
}

async function generateSummary(input:string):Promise<SummaryAnalysisGeneration>{
  let lastReason='';
  for(let attempt=0;attempt<3;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 생성은 길이/형식 검증에 실패했습니다. 원본 자료로 새로 작성하세요. 실패 원인: ${lastReason}`;
    const raw=await askClaudeJson({
      system: SUMMARY_SYSTEM,
      schema: summaryAnalysisRawSchema,
      maxTokens: 2600,
      input:`${input}${retry}`,
    });
    const normalized=normalizeSummary(raw);
    const parsed=summaryAnalysisGenerationSchema.safeParse(normalized);
    if(parsed.success)return parsed.data;
    lastReason=validationReason(parsed.error);
  }
  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason||'SUMMARY_LENGTH_FAILED'}`);
}

async function uniqueShareCode() {
  const supabase = getSupabaseServer();
  for (let i = 0; i < 8; i += 1) {
    const code = generateShareCode();
    const { data, error } = await supabase.rpc('character2_share_code_exists', { p_share_code: code });
    if (error) throw error;
    if (data !== true) return code;
  }
  throw new Error('SHARE_CODE_EXHAUSTED');
}

export async function POST(request: Request) {
  try {
    await assertRateLimit('character_finalize', 8, 60);
    const body = requestSchema.parse(await request.json());

    const inferenceReview = {
      confirmed: body.draft.aiInferences
        .filter(x => x.ownerVerdict === 'confirmed')
        .map(x => ({ text: x.text, evidence: x.evidence })),
      ambiguous: body.draft.aiInferences
        .filter(x => x.ownerVerdict === 'ambiguous')
        .map(x => ({ text: x.text, evidence: x.evidence, ownerFeedback: x.ownerFeedback?.trim() || '' })),
      rejectedCorrections: body.draft.aiInferences
        .filter(x => x.ownerVerdict === 'rejected' && x.ownerFeedback?.trim())
        .map(x => ({ ownerCorrection: x.ownerFeedback!.trim() })),
    };

    const analysisDraft = {
      basicProfile: body.draft.basicProfile,
      traits: body.draft.traits,
      relationshipTraits: body.draft.relationshipTraits,
      confirmedFacts: body.draft.confirmedFacts,
      analysisConfidence: body.draft.analysisConfidence,
    };

    const summaryInput=`캐릭터 데이터:\n${JSON.stringify(analysisDraft)}\n\nAI 추론에 대한 오너 검수:\n${JSON.stringify(inferenceReview)}\n\n오너 인터뷰 20문항:\n${JSON.stringify(body.answers)}\n\n규칙:\n- rejectedCorrections.ownerCorrection은 오너가 직접 확정한 실제 설정입니다.\n- ambiguous.ownerFeedback이 있으면 그 피드백을 추론 원문보다 우선하세요.\n- confirmed만 오너가 그대로 맞다고 확인한 AI 해석입니다.\n- 공개/비밀 프로필을 모두 이해하되 비밀 프로필 원문을 그대로 복사하지 마세요.\n- 지금은 상세 원문을 쓰지 않습니다. 무료 요약과 이후 상세 생성을 위한 압축 분석 씨앗만 만드세요.\n\n출력:\n- oneLineSummary: 25~80자 한 문장.\n- summary.outerSelf / innerSelf / conflictStyle / affectionStyle: 각각 70~160자. 결제 전 보이는 짧은 해석.\n- analysisSeeds: 6~10개. 각 20~140자. 상세 리포트에서 확장할 핵심 행동 규칙, 관계 패턴, 예외, 모순, 중요한 맥락을 겹치지 않게 압축. 프로필 원문 인용 금지.\n\nJSON 키는 oneLineSummary, summary, analysisSeeds만 사용하세요.`;

    const summaryResult = await generateSummary(summaryInput);

    const supabase = getSupabaseServer();
    const shareCode = await uniqueShareCode();
    const editToken = createEditToken();
    const characterId = crypto.randomUUID();
    const { name, age, gender, profileText } = body.draft.basicProfile;

    const sharedInferences = body.draft.aiInferences.map(inference => ({
      id: inference.id,
      text: inference.text,
      confidence: inference.confidence,
      evidenceIds: [],
      evidence: [],
      ownerVerdict: inference.ownerVerdict,
    }));

    // The public passport intentionally contains no paid detail text.
    const passport = characterPassportSchema.parse({
      schemaVersion: 'character-passport/1.0',
      characterId,
      shareCode,
      basicProfile: { name, age, gender, profileText },
      traits: body.draft.traits,
      relationshipTraits: body.draft.relationshipTraits,
      confirmedFacts: body.draft.confirmedFacts,
      aiInferences: sharedInferences,
      interview: { version: 'interview/1.0', completedCount: 20, answers: body.answers },
      analysis: {
        oneLineSummary: summaryResult.oneLineSummary,
        summary: summaryResult.summary,
        outerSelf: '',
        innerSelf: '',
        coreValues: [],
        desires: [],
        fears: [],
        conflictStyle: '',
        affectionStyle: '',
        misunderstoodPoints: [],
        contradictions: [],
        interestingPoints: [],
      },
      engineVersions: { parser: 'parser/1.3', interview: 'interview/1.4', analysis: 'summary/1.0' },
    });

    const detailSeed = {
      version: 'detail-seed/1.0',
      name,
      oneLineSummary: summaryResult.oneLineSummary,
      summary: summaryResult.summary,
      analysisSeeds: summaryResult.analysisSeeds,
    };

    const { data: saved, error: saveError } = await supabase.rpc('character2_create_character_preview', {
      p_character_id: characterId,
      p_share_code: shareCode,
      p_name: name,
      p_schema_version: passport.schemaVersion,
      p_passport_json: passport,
      p_analysis_confidence: body.draft.analysisConfidence,
      p_engine_versions: passport.engineVersions,
      p_answers: body.answers,
      p_edit_token_hash: sha256(editToken),
      p_detail_seed_json: detailSeed,
    });
    if (saveError) throw saveError;
    if (saved !== true) throw new Error('CHARACTER_SAVE_FAILED');

    const preview = buildCharacterReportPreview(passport);
    return NextResponse.json({ preview, shareCode, editToken });
  } catch (error) {
    return apiError(error);
  }
}
