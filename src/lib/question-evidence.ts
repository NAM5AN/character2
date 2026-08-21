import type { InterviewQuestion } from '@/lib/schemas/question';

export const QUESTION_EVIDENCE_INSTRUCTIONS = `질문 근거(evidence) 규칙 — 매우 중요:
- 새로 생성하는 모든 문항은 evidence에 1~2개의 원문 발췌를 넣으세요.
- evidence는 질문의 소재가 실제로 나온 공개 프로필, 비밀 프로필, 오너 검수 메모, 이전 인터뷰 질문·답변·이유 중에서 연속된 구절을 그대로 복사한 것입니다. 요약하거나 문장을 새로 만들지 마세요.
- evidence는 보통 12~120자 정도의 짧은 연속 발췌로 충분합니다. 필요한 구절만 짧게 복사하고 문단 전체를 길게 넣지 마세요.
- 프로필의 서로 다른 위치에 있는 사실·대사·행동을 원문에서 연결되지 않았는데 하나의 사건, 문답, 인과관계처럼 합치면 실패입니다.
- 특히 “A라는 질문에 B라고 답했다”, “A라고 말한 뒤 B했다”처럼 두 발화나 행동의 직접 관계를 질문에 넣으려면, 그 관계가 실제로 드러나는 하나의 연속된 evidence 발췌 안에 두 요소가 함께 있어야 합니다.
- 질문에 따옴표로 원문 대사나 표현을 인용하면 그 인용문은 evidence에도 실제로 존재해야 합니다. 서로 다른 문단에서 따로 가져온 두 인용문을 한 문답처럼 엮지 마세요.
- 서로 멀리 떨어진 두 단서를 비교·대조하는 질문 자체는 가능하지만, 원문에서 같은 사건이었다고 가장하지 말고 각각의 evidence를 따로 제시하세요.
- evidence는 사용자 화면에 보여주기 위한 문구가 아니라 서버 검증용 내부 근거입니다.`;

function normalizeSpace(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizeLoose(value: string) {
  return normalizeSpace(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function questionEvidenceSources(args: {
  publicProfile: string;
  secretProfile?: string;
  ownerReview?: string[];
  answers?: Array<{ question?: string; answer?: string; reason?: string }>;
}) {
  return [
    args.publicProfile,
    args.secretProfile || '',
    ...(args.ownerReview || []),
    ...(args.answers || []).flatMap(item => [item.question || '', item.answer || '', item.reason || '']),
  ]
    .map(normalizeSpace)
    .filter(Boolean);
}

function evidenceExistsInSources(evidence: string, sources: string[]) {
  const needle = normalizeSpace(evidence);
  if (!needle) return false;

  // Fast path: exact contiguous source excerpt after whitespace normalization.
  if (sources.some(source => source.includes(needle))) return true;

  // Models frequently preserve the exact words but normalize quotation marks,
  // bullets or punctuation. Treat those formatting-only differences as the same
  // contiguous excerpt instead of regenerating the entire interview question.
  // Word/character order still has to match, so paraphrases remain invalid.
  const looseNeedle = normalizeLoose(needle);
  if (looseNeedle.length < 4) return false;
  return sources.some(source => normalizeLoose(source).includes(looseNeedle));
}

export function quotedPhrases(question: string) {
  const out: string[] = [];
  const seen = new Set<string>();
  const regex = /[“"‘']([^”"’']{2,100})[”"’']/gu;
  for (const match of question.matchAll(regex)) {
    const phrase = match[1]?.trim();
    if (!phrase) continue;
    const key = normalizeLoose(phrase);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
  }
  return out;
}

function evidenceContainsPhrase(evidence: string, phrase: string) {
  const haystack = normalizeLoose(evidence);
  const needle = normalizeLoose(phrase);
  return needle.length >= 2 && haystack.includes(needle);
}

function impliesDirectAssociation(question: string) {
  return /(라는?\s*질문에|라는?\s*말에|라고\s*(?:묻|물|답|대답|말)|대답한|답한|말한\s*(?:뒤|후)|한\s*(?:뒤|후))/u.test(question);
}

export function questionEvidenceIssues(question: InterviewQuestion, sources: string[]) {
  const issues: Array<{ path: Array<string | number>; message: string }> = [];
  const evidence = question.evidence || [];

  if (evidence.length < 1 || evidence.length > 2) {
    issues.push({ path: ['evidence'], message: '새 질문에는 원문 evidence를 1~2개 넣어야 합니다.' });
    return issues;
  }

  evidence.forEach((quote, index) => {
    if (!evidenceExistsInSources(quote, sources)) {
      issues.push({ path: ['evidence', index], message: 'evidence는 실제 프로필/오너 검수/이전 문답의 연속된 원문 구절이어야 합니다.' });
    }
  });

  const quoted = quotedPhrases(question.question);
  for (const phrase of quoted) {
    if (!evidence.some(item => evidenceContainsPhrase(item, phrase))) {
      issues.push({ path: ['question'], message: `질문에 인용한 “${phrase.slice(0, 30)}”가 evidence에 없습니다.` });
    }
  }

  if (quoted.length >= 2 && impliesDirectAssociation(question.question)) {
    const sameContext = evidence.some(item => quoted.every(phrase => evidenceContainsPhrase(item, phrase)));
    if (!sameContext) {
      issues.push({
        path: ['question'],
        message: '두 인용문을 직접 문답/사건 관계로 묶으려면 두 문구가 같은 연속 evidence 안에 함께 있어야 합니다.',
      });
    }
  }

  return issues;
}

// 질문이 원문 대사를 따옴표로 인용했는데 evidence 에 그 구절이 빠진 경우가 잦다.
// 인용문을 실제로 담고 있는 원문 구절을 찾아 evidence 로 쓸 수 있게 돌려준다.
// 원문에 없는 인용이면 빈 문자열을 돌려 재생성 경로로 보낸다(근거를 지어내지 않는다).
export function sourceExcerptForPhrase(phrase: string, sources: string[]) {
  const needle = normalizeSpace(phrase);
  if (needle.length < 2) return '';
  for (const raw of sources) {
    const source = normalizeSpace(raw);
    const at = source.indexOf(needle);
    if (at < 0) continue;
    // 인용문 앞뒤 문맥을 조금 붙여 8~420자 범위의 연속 구절로 자른다.
    const start = Math.max(0, at - 60);
    const end = Math.min(source.length, at + needle.length + 60);
    const excerpt = source.slice(start, end).trim();
    if (excerpt.length >= 8 && excerpt.length <= 420) return excerpt;
    if (excerpt.length > 420) return excerpt.slice(0, 420).trim();
  }
  return '';
}
