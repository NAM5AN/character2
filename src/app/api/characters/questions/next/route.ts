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

const QUESTION_PLAN = [
  { category: 'core', lens: '가치 우선순위', scene: '서로 매력적인 두 선택지 사이의 일상적 선택' },
  { category: 'core', lens: '결정 방식과 주도권', scene: '정보가 불완전한 개인적 결정' },
  { category: 'core', lens: '자기인식과 타인의 평가', scene: '오해·평가·첫인상이 개입되는 장면' },
  { category: 'core', lens: '동기와 성취 방식', scene: '기회·목표·노력의 우선순위를 정하는 장면' },
  { category: 'core', lens: '경계선과 융통성', scene: '예상 밖 부탁·규칙 변화·개인적 한계' },
  { category: 'relationship', lens: '새 관계를 시작하는 방식', scene: '처음 만나는 사람과의 거리 조절' },
  { category: 'relationship', lens: '신뢰와 자기공개', scene: '약점·비밀·개인적인 정보를 나누는 순간' },
  { category: 'relationship', lens: '돌봄과 애정 표현', scene: '도움을 주거나 받는 장면' },
  { category: 'relationship', lens: '친밀감과 자율성의 균형', scene: '연락·공간·부재·혼자 있는 시간' },
  { category: 'relationship', lens: '집단 안 역할과 권력관계', scene: '여럿이 함께 있는 자리·리더·선후배 관계' },
  { category: 'conflict', lens: '의견 충돌 처리', scene: '같은 목표를 두고 방법이 갈리는 장면' },
  { category: 'conflict', lens: '신뢰가 깨졌을 때의 반응', scene: '약속 위반·실망·배신 가능성이 생긴 장면' },
  { category: 'conflict', lens: '실수·책임·비난을 다루는 방식', scene: '본인 또는 타인의 실수로 결과가 틀어진 장면' },
  { category: 'conflict', lens: '압박과 불확실성 대응', scene: '시간 부족·예상 밖 변수·즉석 판단이 필요한 장면' },
  { category: 'conflict', lens: '가치 충돌과 손해 감수', scene: '어느 쪽을 택해도 무언가를 포기해야 하는 선택' },
  { category: 'inner', lens: '원하는 것과 실제 행동의 차이', scene: '아무도 보지 않는 사적인 선택' },
  { category: 'inner', lens: '이상적 자아와 반복되는 습관의 차이', scene: '평소 반복되는 작은 행동이나 버릇' },
  { category: 'inner', lens: '후회·수치·자기보호 이후의 내적 정리', scene: '일이 끝난 뒤 혼자 되돌아보는 순간' },
  { category: 'validation', lens: '가장 강한 기존 해석의 반례 찾기', scene: '그 특성이 평소와 다르게 나타날 수 있는 완전히 새로운 맥락' },
  { category: 'validation', lens: '서로 경쟁하는 두 캐릭터 해석의 최종 검증', scene: '한쪽으로 쉽게 결론 내릴 수 없는 새로운 선택 상황' },
] as const;

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

    const plan = QUESTION_PLAN[order - 1];
    const priorEvidence = body.answers.map(a => ({ order: a.order, question: a.question, answer: a.answer }));
    const hardBan = body.answers.slice(-2).map(a => ({ question: a.question, answer: a.answer }));
    const canSynthesize = order >= 19;

    const question = await askOpenAIJson({
      instructions: QUESTION_INSTRUCTIONS,
      schema: interviewQuestionSchema,
      maxOutputTokens: 1400,
      input: `현재 문항 번호: ${order}/20

이번 문항의 강제 탐색 계획:
- category: ${plan.category}
- 반드시 탐색할 새 렌즈: ${plan.lens}
- 사용할 상황군: ${plan.scene}

캐릭터 데이터:
${JSON.stringify(compactDraft)}

이전 문답 전체 — 캐릭터 맞춤화, 현재 행동 가설 추정, 중복 방지를 위한 참고 증거입니다. 직전 대화를 이어가기 위한 소재가 아닙니다:
${JSON.stringify(priorEvidence)}

직전 2개 문답 — 아래 문답에서 사용한 구체적 상황, 등장인물 관계, 감정 흐름, 갈등 소재를 이번 질문에서 이어서 사용하지 마세요:
${JSON.stringify(hardBan)}

이미 사용한 질문:
${JSON.stringify(body.answers.map(a => a.question))}

이번 질문을 만들 때 내부적으로 먼저 다음 두 종류의 캐릭터 가설을 세우세요:
A. 현재 공개·비밀 프로필, 확인된 설정, 거절되지 않은 추론, 이전 답변을 종합했을 때 가장 자연스럽게 예상되는 행동 패턴.
B. A와 다르지만 공식 설정을 깨뜨리지 않으며, 선택될 경우 이 캐릭터를 새롭게 해석하게 만들 경쟁 행동 패턴.

그 다음 선택지를 설계하세요:
- 기본 4개를 권장합니다.
- 1~2개는 A에서 파생된 구체적인 예상 행동이어야 합니다.
- 1~2개는 B에서 파생된 충분히 그럴듯한 경쟁 행동이어야 합니다.
- 필요하면 1개는 상대/상황에 따라 달라지는 조건부 행동이어도 됩니다.
- 어느 선택지가 A/B인지 사용자가 짐작하지 못하게 순서를 섞으세요.
- A와 B 모두 캐릭터에게 실제로 가능한 모습이어야 합니다. 억지 반대 성격이나 개그성 오답을 만들지 마세요.
- 선택지는 성격 단어가 아니라 이 장면에서 실제로 하는 말·행동·선택으로 작성하세요.
- 선택지만 읽어도 '이걸 고르면 결과가 이렇게 나오겠구나'가 노골적으로 보이면 실패입니다.

추가 규칙:
- 이번 질문은 이전 질문의 후속질문처럼 느껴지면 실패입니다.
- 이번 렌즈 하나만 선명하게 보되, 특정 성격 결론을 유도하지 마세요.
- 프로필과 이전 답변을 활용해 이 캐릭터에게 어울리는 고유한 디테일을 넣되, 이전 상황 자체는 재사용하지 마세요.
- ${canSynthesize ? 'validation 단계이므로 이전 패턴을 종합해도 되지만 반드시 새로운 상황에서 반례/경쟁 가설을 검증하세요.' : '이전 답변의 이유를 더 캐묻지 말고, 아직 보지 않은 면을 새 상황에서 관찰하세요.'}
- order=${order}, category="${plan.category}"로 출력하세요.
- 출력 키는 order, category, question, options, allowCustom, rationale만 사용하세요.
- options는 3~5개의 문자열 배열, allowCustom은 boolean입니다.
- rationale에는 사용자에게 보여줄 설명이 아니라, 이 질문이 어떤 현재 가설과 어떤 경쟁 가설을 구분하려는지 내부용으로 1~2문장만 적으세요.`,
    });

    return NextResponse.json({ done: false, question });
  } catch (error) {
    return apiError(error);
  }
}
