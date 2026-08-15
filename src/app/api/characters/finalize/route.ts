import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, finalAnalysisSchema, interviewAnswerSchema, characterPassportSchema } from '@/lib/schemas/character';
import { askClaudeJson } from '@/lib/ai/anthropic';
import { FINAL_ANALYSIS_SYSTEM } from '@/lib/ai/prompts';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { generateShareCode } from '@/lib/share-code';
import { createEditToken, sha256 } from '@/lib/crypto';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  draft: characterDraftSchema,
  answers: z.array(interviewAnswerSchema).length(20),
  accessCode: z.string().min(1),
});

async function uniqueShareCode() {
  const supabase = getSupabaseAdmin();
  for (let i = 0; i < 8; i += 1) {
    const code = generateShareCode();
    const { data, error } = await supabase.from('characters').select('id').eq('share_code', code).maybeSingle();
    if (error) throw error;
    if (!data) return code;
  }
  throw new Error('SHARE_CODE_EXHAUSTED');
}

export async function POST(request: Request) {
  try {
    await assertRateLimit('character_finalize', 8, 60);
    const body = requestSchema.parse(await request.json());
    if (!(await validateAccessCode(body.accessCode))) throw new Error('CODE_INVALID');

    const analysis = await askClaudeJson({
      system: FINAL_ANALYSIS_SYSTEM,
      schema: finalAnalysisSchema,
      maxTokens: 3500,
      input: `캐릭터 데이터:\n${JSON.stringify(body.draft)}\n\n오너 인터뷰 20문항:\n${JSON.stringify(body.answers)}\n\n최종 캐해 JSON을 작성하세요.`,
    });

    const supabase = getSupabaseAdmin();
    const shareCode = await uniqueShareCode();
    const editToken = createEditToken();
    const characterId = crypto.randomUUID();
    const passport = characterPassportSchema.parse({
      schemaVersion: 'character-passport/1.0',
      characterId,
      shareCode,
      basicProfile: body.draft.basicProfile,
      traits: body.draft.traits,
      relationshipTraits: body.draft.relationshipTraits,
      confirmedFacts: body.draft.confirmedFacts,
      aiInferences: body.draft.aiInferences,
      interview: { version: 'interview/1.0', completedCount: 20, answers: body.answers },
      analysis,
      engineVersions: { parser: 'parser/1.0', interview: 'interview/1.0', analysis: 'analysis/1.0' },
    });

    const { error: characterError } = await supabase.from('characters').insert({
      id: characterId,
      share_code: shareCode,
      name: body.draft.basicProfile.name,
      status: 'ready',
      schema_version: passport.schemaVersion,
    });
    if (characterError) throw characterError;

    const { error: passportError } = await supabase.from('character_passports').insert({
      character_id: characterId,
      passport_json: passport,
      analysis_confidence: body.draft.analysisConfidence,
      engine_versions: passport.engineVersions,
    });
    if (passportError) throw passportError;

    const { error: answerError } = await supabase.from('character_answers').insert(
      body.answers.map(a => ({
        character_id: characterId,
        question_order: a.order,
        question_text: a.question,
        answer_json: { answer: a.answer },
        branch_context: a.branchContext ?? {},
        question_engine_version: 'interview/1.0',
      })),
    );
    if (answerError) throw answerError;

    const { error: accessError } = await supabase.from('character_access').insert({
      character_id: characterId,
      edit_token_hash: sha256(editToken),
    });
    if (accessError) throw accessError;

    return NextResponse.json({ passport, shareCode, editToken });
  } catch (error) {
    return apiError(error);
  }
}
