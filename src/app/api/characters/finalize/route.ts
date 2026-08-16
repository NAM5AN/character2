import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, finalAnalysisSchema, interviewAnswerSchema, characterPassportSchema } from '@/lib/schemas/character';
import { askClaudeJson } from '@/lib/ai/anthropic';
import { FINAL_ANALYSIS_SYSTEM } from '@/lib/ai/prompts';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { generateShareCode } from '@/lib/share-code';
import { createEditToken, sha256 } from '@/lib/crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  draft: characterDraftSchema,
  answers: z.array(interviewAnswerSchema).length(20),
  accessCode: z.string().min(1),
});

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
    if (!(await validateAccessCode(body.accessCode))) throw new Error('CODE_INVALID');

    const inferenceReview = {
      confirmed: body.draft.aiInferences
        .filter(x => x.ownerVerdict === 'confirmed')
        .map(x => ({ text: x.text, evidence: x.evidence })),
      ambiguous: body.draft.aiInferences
        .filter(x => x.ownerVerdict === 'ambiguous')
        .map(x => ({ text: x.text, evidence: x.evidence, ownerFeedback: x.ownerFeedback?.trim() || '' })),
      rejectedCorrections: body.draft.aiInferences
        .filter(x => x.ownerVerdict === 'rejected' && x.ownerFeedback?.trim())
        .map(x => ({ rejectedInference: x.text, ownerCorrection: x.ownerFeedback!.trim() })),
    };

    const analysisDraft = {
      basicProfile: body.draft.basicProfile,
      traits: body.draft.traits,
      relationshipTraits: body.draft.relationshipTraits,
      confirmedFacts: body.draft.confirmedFacts,
      analysisConfidence: body.draft.analysisConfidence,
    };

    const analysis = await askClaudeJson({
      system: FINAL_ANALYSIS_SYSTEM,
      schema: finalAnalysisSchema,
      maxTokens: 3500,
      input: `캐릭터 데이터:\n${JSON.stringify(analysisDraft)}\n\nAI 추론에 대한 오너 검수:\n${JSON.stringify(inferenceReview)}\n\n오너 인터뷰 20문항:\n${JSON.stringify(body.answers)}\n\n오너 검수 피드백 사용 규칙:\n- rejectedCorrections.ownerCorrection은 오너가 직접 알려준 실제 설정으로 취급하세요.\n- rejectedCorrections.rejectedInference는 틀린 AI 추론이므로 사실, 가능성, 분석 근거로 절대 재사용하지 마세요.\n- ambiguous.ownerFeedback이 있으면 그 피드백을 AI 추론 문장보다 우선하세요. 추론 원문은 일부만 맞을 수 있는 불확실한 해석입니다.\n- ambiguous.ownerFeedback이 없으면 해당 추론은 확정 근거가 아니라 가능성 수준으로만 취급하세요.\n- confirmed에 있는 추론만 오너가 그대로 맞다고 확인한 해석입니다.\n- 오너가 직접 쓴 검수 피드백과 인터뷰 답변/이유는 AI 추론보다 우선순위가 높은 근거입니다.\n\n공개 프로필과 비밀 프로필을 모두 근거로 최종 캐해를 작성하되, 비밀 프로필 원문을 길게 인용하거나 그대로 복사하지 마세요.\n\n최종 캐해 JSON을 작성하세요. 출력 키는 oneLineSummary, outerSelf, innerSelf, coreValues, desires, fears, conflictStyle, affectionStyle, misunderstoodPoints, contradictions, interestingPoints입니다. coreValues/desires/fears/misunderstoodPoints/contradictions/interestingPoints는 문자열 배열입니다.`,
    });

    const supabase = getSupabaseServer();
    const shareCode = await uniqueShareCode();
    const editToken = createEditToken();
    const characterId = crypto.randomUUID();
    const { name, age, gender, profileText } = body.draft.basicProfile;

    // Raw grounding excerpts/IDs can point into the secret profile, and owner
    // corrections may also contain private settings. Use them for analysis but
    // do not expose those raw materials through the read-only share passport.
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
      analysis,
      engineVersions: { parser: 'parser/1.3', interview: 'interview/1.3', analysis: 'analysis/1.3' },
    });

    const { data: saved, error: saveError } = await supabase.rpc('character2_create_character', {
      p_character_id: characterId,
      p_share_code: shareCode,
      p_name: body.draft.basicProfile.name,
      p_schema_version: passport.schemaVersion,
      p_passport_json: passport,
      p_analysis_confidence: body.draft.analysisConfidence,
      p_engine_versions: passport.engineVersions,
      p_answers: body.answers,
      p_edit_token_hash: sha256(editToken),
      p_access_code: body.accessCode,
    });
    if (saveError) throw saveError;
    if (saved !== true) throw new Error('CHARACTER_SAVE_FAILED');

    return NextResponse.json({ passport, shareCode, editToken });
  } catch (error) {
    return apiError(error);
  }
}
