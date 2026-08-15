import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, interviewAnswerSchema } from '@/lib/schemas/character';
import { interviewQuestionSchema } from '@/lib/schemas/question';
import { askOpenAIJson } from '@/lib/ai/openai';
import { QUESTION_INSTRUCTIONS } from '@/lib/ai/prompts';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  draft: characterDraftSchema,
  answers: z.array(interviewAnswerSchema).max(19),
  accessCode: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    await assertRateLimit('question_next', 60, 60);
    const body = requestSchema.parse(await request.json());
    if (!(await validateAccessCode(body.accessCode))) throw new Error('CODE_INVALID');
    const order = body.answers.length + 1;
    if (order > 20) return NextResponse.json({ done: true });

    const compactDraft = {
      basicProfile: body.draft.basicProfile,
      traits: body.draft.traits,
      relationshipTraits: body.draft.relationshipTraits,
      confirmedFacts: body.draft.confirmedFacts,
      aiInferences: body.draft.aiInferences.filter(x => x.ownerVerdict !== 'rejected'),
      analysisConfidence: body.draft.analysisConfidence,
    };
    const recentAnswers = body.answers.slice(-6);
    const question = await askOpenAIJson({
      instructions: QUESTION_INSTRUCTIONS,
      schema: interviewQuestionSchema,
      maxOutputTokens: 1200,
      input: `현재 문항 번호: ${order}/20\n\n캐릭터 데이터:\n${JSON.stringify(compactDraft)}\n\n최근 답변:\n${JSON.stringify(recentAnswers)}\n\n이미 물어본 질문 전체:\n${JSON.stringify(body.answers.map(a => a.question))}\n\n현재 문항 번호에 맞는 category를 사용하고, order=${order}로 출력하세요. 출력 키는 order, category, question, options, allowCustom, rationale만 사용하세요. options는 3~5개의 문자열 배열, allowCustom은 boolean입니다.`,
    });
    return NextResponse.json({ done: false, question });
  } catch (error) {
    return apiError(error);
  }
}
