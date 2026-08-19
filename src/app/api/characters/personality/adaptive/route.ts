import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, interviewAnswerSchema } from '@/lib/schemas/character';
import { inferInterviewAdaptiveTags } from '@/lib/ai/personality-adaptive';
import { withAiUsageContext } from '@/lib/ai/usage';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  draft: characterDraftSchema,
  answers: z.array(interviewAnswerSchema).length(20),
});

export async function POST(request: Request) {
  try {
    await assertRateLimit('personality_adaptive', 12, 60);
    const body = requestSchema.parse(await request.json());
    const tags = await withAiUsageContext(
      { sessionId: body.draft.usageSessionId, stage: 'personality_interview' },
      () => inferInterviewAdaptiveTags(body.draft, body.answers),
    );
    return NextResponse.json({ tags });
  } catch (error) {
    return apiError(error);
  }
}
