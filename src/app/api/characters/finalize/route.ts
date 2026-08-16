import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  characterDraftSchema,
  characterEvidencePackSchema,
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
이번 단계에서는 결제 전 공개할 짧은 요약과, 결제 후 상세 리포트가 원자료를 최대한 잃지 않고 이어받을 수 있는 구조화 Evidence Pack을 만듭니다.
긴 상세 리포트와 긴 유형별 원문은 아직 작성하지 마세요.
입력된 공개 프로필, 비밀 프로필, 오너가 검수한 AI 추론, 오너의 정정/보충, 20문항 답변과 답변 이유만 근거로 하며 없는 설정을 만들지 마세요.
오너의 직접 정정과 인터뷰 답변/이유는 AI 추론보다 우선합니다.
Evidence Pack은 '대표적인 특징 몇 개'를 고르는 요약이 아니라 상세 분석으로 넘길 정보 보존용 중간 포맷입니다. 눈에 띄는 설정만 남기지 말고, 행동을 구분하는 예외·관계 차이·사소하지만 고유한 디테일까지 폭넓게 보존하세요.
비밀 프로필 원문이나 인터뷰 문장을 길게 복사하지 말고 의미를 보존해 압축하세요. 원문에 없는 심리 원인을 보충하지 마세요.`;

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

function normalizeTextArray(value: unknown, maxItems: number) {
  const raw=Array.isArray(value) ? value : typeof value==='string' ? value.split(/\n+/) : [];
  return [...new Set(raw.map(asText).map(x=>clipText(x,190)).filter(x=>x.length>=12))].slice(0,maxItems);
}

function normalizeInterviewEvidence(value: unknown) {
  if(!Array.isArray(value))return [];
  const byOrder=new Map<number,{order:number;finding:string}>();
  for(const item of value){
    const record=asRecord(item);
    const order=Number(record.order ?? record.questionOrder ?? record.question_order);
    const finding=clipText(asText(record.finding ?? record.text ?? record.summary ?? record.evidence),190);
    if(Number.isInteger(order)&&order>=1&&order<=20&&finding.length>=18&&!byOrder.has(order)){
      byOrder.set(order,{order,finding});
    }
  }
  return [...byOrder.values()].sort((a,b)=>a.order-b.order);
}

function normalizeEvidencePack(value: unknown) {
  const pack=asRecord(value);
  return {
    version:'evidence-pack/2.0' as const,
    publicProfileEvidence:normalizeTextArray(pack.publicProfileEvidence,32),
    secretProfileEvidence:normalizeTextArray(pack.secretProfileEvidence,28),
    ownerReviewEvidence:normalizeTextArray(pack.ownerReviewEvidence,20),
    interviewEvidence:normalizeInterviewEvidence(pack.interviewEvidence),
    behaviorRules:normalizeTextArray(pack.behaviorRules,14),
    relationshipPatterns:normalizeTextArray(pack.relationshipPatterns,12),
    emotionalPatterns:normalizeTextArray(pack.emotionalPatterns,12),
    valuesAndMotives:normalizeTextArray(pack.valuesAndMotives,12),
    exceptionsAndConditions:normalizeTextArray(pack.exceptionsAndConditions,12),
    tensionsAndContradictions:normalizeTextArray(pack.tensionsAndContradictions,10),
    distinctiveDetails:normalizeTextArray(pack.distinctiveDetails,16),
    uncertainties:normalizeTextArray(pack.uncertainties,10),
  };
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
    evidencePack: normalizeEvidencePack(raw.evidencePack),
  };
}

function validationReason(error: z.ZodError) {
  return error.issues.slice(0,16).map(issue=>`${issue.path.join('.')||'(root)'}: ${issue.message}`).join('; ');
}

async function generateSummary(input:string):Promise<SummaryAnalysisGeneration>{
  let lastReason='';
  for(let attempt=0;attempt<3;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 생성은 길이/형식/커버리지 검증에 실패했습니다. 이전 출력을 수리하지 말고 원본 자료로 새로 작성하세요. 실패 원인: ${lastReason}`;
    const raw=await askClaudeJson({
      system: SUMMARY_SYSTEM,
      schema: summaryAnalysisRawSchema,
      maxTokens: 6800,
      input:`${input}${retry}`,
    });
    const normalized=normalizeSummary(raw);
    const parsed=summaryAnalysisGenerationSchema.safeParse(normalized);
    if(parsed.success)return parsed.data;
    lastReason=validationReason(parsed.error);
  }
  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason||'SUMMARY_EVIDENCE_PACK_FAILED'}`);
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

    const summaryInput=`캐릭터 데이터:\n${JSON.stringify(analysisDraft)}\n\nAI 추론에 대한 오너 검수:\n${JSON.stringify(inferenceReview)}\n\n오너 인터뷰 20문항:\n${JSON.stringify(body.answers)}\n\nEvidence Pack 작성 원칙:\n- rejectedCorrections.ownerCorrection은 오너가 직접 확정한 실제 설정입니다. ownerReviewEvidence에 반드시 보존하세요.\n- ambiguous.ownerFeedback이 있으면 그 피드백을 추론 원문보다 우선하고 ownerReviewEvidence에 보존하세요.\n- confirmed만 오너가 그대로 맞다고 확인한 AI 해석입니다.\n- publicProfileEvidence에는 공개 프로필에서 상세 캐해에 도움이 될 사실·행동·관계·고유 디테일을 폭넓게 남기세요. 단순 외형도 캐릭터를 구분하는 의미가 있으면 보존하고, 의미가 없으면 의미를 창작하지 않은 사실 수준으로 보존할 수 있습니다.\n- secretProfileEvidence에는 비밀 프로필의 중요한 사실·과거·동기·관계·숨은 조건을 원문 복사 없이 의미 보존형으로 남기세요. 비밀 프로필이 없으면 []입니다.\n- interviewEvidence는 반드시 정확히 20개이며 order 1~20이 각각 한 번씩 있어야 합니다. 각 finding은 해당 문항의 answer와 reason에서 새로 확인된 사실·행동규칙·예외를 한 문장으로 보존하세요. 선택한 보기만 보고 일반화하지 말고 reason이 있으면 함께 반영하세요.\n- behaviorRules / relationshipPatterns / emotionalPatterns / valuesAndMotives는 여러 근거를 묶어 한 단계 해석한 규칙입니다.\n- exceptionsAndConditions에는 '항상 그렇지는 않은 조건', 관계별 차이, 상황에 따라 바뀌는 기준을 우선 보존하세요.\n- tensionsAndContradictions에는 동시에 성립하는 상반된 면을 적되 억지 모순을 만들지 마세요.\n- distinctiveDetails에는 다른 캐릭터와 구분되는 습관·물건·관계·말버릇·사건·취향·역할 등 고유 디테일을 보존하세요.\n- uncertainties에는 아직 확정할 수 없거나 오너 답변끼리 조건이 불명확한 부분만 적으세요.\n- Evidence Pack은 무료 요약을 반복하는 곳이 아닙니다. 상세 AI가 원자료를 다시 읽지 않아도 최대한 정확히 재구성할 수 있을 정도로 정보 폭을 보존하세요.\n- 그렇다고 프로필/비밀 프로필/질의응답 원문을 길게 복사하지 마세요. 한 항목은 12~190자 안에서 의미를 압축합니다.\n\n무료 출력:\n- oneLineSummary: 25~80자 한 문장.\n- summary.outerSelf / innerSelf / conflictStyle / affectionStyle: 각각 70~160자.\n\nEvidence Pack JSON 구조:\n{\n  \"version\":\"evidence-pack/2.0\",\n  \"publicProfileEvidence\":[\"...\"],\n  \"secretProfileEvidence\":[\"...\"],\n  \"ownerReviewEvidence\":[\"...\"],\n  \"interviewEvidence\":[{\"order\":1,\"finding\":\"...\"}, ... {\"order\":20,\"finding\":\"...\"}],\n  \"behaviorRules\":[\"...\"],\n  \"relationshipPatterns\":[\"...\"],\n  \"emotionalPatterns\":[\"...\"],\n  \"valuesAndMotives\":[\"...\"],\n  \"exceptionsAndConditions\":[\"...\"],\n  \"tensionsAndContradictions\":[\"...\"],\n  \"distinctiveDetails\":[\"...\"],\n  \"uncertainties\":[\"...\"]\n}\n\n최종 JSON 키는 oneLineSummary, summary, evidencePack만 사용하세요.`;

    const summaryResult = await generateSummary(summaryInput);
    characterEvidencePackSchema.parse(summaryResult.evidencePack);

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
      engineVersions: { parser: 'parser/1.3', interview: 'interview/1.4', analysis: 'summary-evidence/2.0' },
    });

    const detailSeed = {
      version: 'detail-seed/2.0',
      name,
      oneLineSummary: summaryResult.oneLineSummary,
      summary: summaryResult.summary,
      evidencePack: summaryResult.evidencePack,
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
