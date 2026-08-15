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

    const analysis = await askClaudeJson({
      system: FINAL_ANALYSIS_SYSTEM,
      schema: finalAnalysisSchema,
      maxTokens: 3500,
      input: `캐릭터 데이터:\n${JSON.stringify(body.draft)}\n\n오너 인터뷰 20문항:\n${JSON.stringify(body.answers)}\n\n최종 캐해 JSON을 작성하세요.`,
    });

    const supabase = getSupabaseServer();
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
