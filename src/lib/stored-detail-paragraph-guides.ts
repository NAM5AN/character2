import 'server-only';

type UnknownRecord = Record<string, unknown>;

const REPORT_FIELDS = [
  'characterOverview',
  'innerMechanics',
  'relationshipStyle',
  'attachmentStyle',
  'conflictStyleDetailed',
  'charmAndContradictions',
  'integratedReport',
] as const;

type ReportField = typeof REPORT_FIELDS[number];

const BANNED_META = /(?:이 문단|다음 항목|분석해보면|리포트상)/u;

const FALLBACK_LEADS: Record<ReportField, string[]> = {
  characterOverview: [
    '전체적인 인상부터 살펴볼게요.',
    '겉으로 보이는 모습과 실제 내면은 어떻게 다를까요?',
    '자기 자신을 바라보는 방식도 조금 더 들여다볼게요.',
    '타인의 인상과 어디에서 어긋나는지도 볼게요.',
    '과거 경험이 지금에 무엇을 남겼을까요?',
    '여러 단서를 이어 숨은 특성도 짚어볼게요.',
  ],
  innerMechanics: [
    '속에서 무엇이 움직이고 있을까요?',
    '특히 두려워하는 지점도 살펴볼게요.',
    '원하는 것과 실제로 필요한 것은 어떻게 다를까요?',
    '감정이 흔들릴 때 지키려는 기준도 볼게요.',
    '불편한 감정을 처리하는 방식은 어떻게 나타날까요?',
    '스스로도 인정하기 어려운 부분을 조금 더 들여다볼게요.',
    '자기 행동을 납득하는 방식도 이어서 짚어볼게요.',
  ],
  relationshipStyle: [
    '처음 만난 사람을 대하는 태도부터 볼게요.',
    '관계의 거리는 어떤 조건에서 가까워질까요?',
    '가까운 사람 앞에서는 무엇이 달라질까요?',
    '주도권을 주고받는 방식도 살펴볼게요.',
    '사람을 믿는 기준은 어디에서 생길까요?',
    '관계를 오래 유지하는 방법도 함께 짚어볼게요.',
  ],
  attachmentStyle: [
    '호감이 시작되는 순간부터 살펴볼게요.',
    '친밀해질수록 마음은 어떻게 달라질까요?',
    '사랑받고 있다는 것을 무엇으로 확인할까요?',
    '가까운 관계에서 상대에게 바라는 것도 볼게요.',
    '질투하거나 부딪혔을 때는 어떤 반응이 나올까요?',
    '관계가 오래될수록 달라지는 부분이 있어요.',
    '이별 뒤 감정을 정리하는 방식도 살펴볼게요.',
    '어떤 상대와 특히 잘 맞을까요?',
  ],
  conflictStyleDetailed: [
    '갈등을 알아차리는 순간부터 볼게요.',
    '불편함은 언제 자기 기준의 침범으로 바뀔까요?',
    '압박이 커질수록 어떤 면이 드러날까요?',
    '한계에 몰렸을 때의 반응도 살펴볼게요.',
    '절대 양보하지 않는 기준은 무엇일까요?',
    '자신과 타인에게 적용하는 잣대도 짚어볼게요.',
    '극한의 선택에서는 어디로 기울까요?',
  ],
  charmAndContradictions: [
    '먼저 눈에 띄는 매력부터 살펴볼게요.',
    '상반된 모습은 왜 함께 나타날까요?',
    '쉽게 오해받는 지점도 조금 더 볼게요.',
    '같은 특성이 강점과 약점으로 갈리는 부분이에요.',
    '알고 지낼수록 발견되는 면은 무엇일까요?',
    '위험하지만 끌리는 부분도 이어서 짚어볼게요.',
    '여러 단서를 연결하면 무엇이 새롭게 보일까요?',
  ],
  integratedReport: [
    '이제 전체 구조를 하나의 흐름으로 이어볼게요.',
    '욕구와 두려움은 어떻게 맞물려 있을까요?',
    '감정과 자기보호가 연결되는 지점도 살펴볼게요.',
    '관계와 갈등에서는 같은 원리가 어떻게 드러날까요?',
    '겉보기의 모순이 하나로 이어지는 부분이에요.',
    '마지막으로 이 캐릭터의 큰 방향을 짚어볼게요.',
  ],
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function splitParagraphs(text: string) {
  return text
    .replace(/\r\n?/gu, '\n')
    .trim()
    .split(/\n{2,}/u)
    .map(block => block.replace(/[ \t]+/gu, ' ').replace(/\n+/gu, ' ').trim())
    .filter(Boolean);
}

function isShortGuideSentence(value: string) {
  const lead = value.replace(/\s+/gu, ' ').trim();
  if (lead.length < 6 || lead.length > 52) return false;
  if (/[,，;；:：]/u.test(lead) || BANNED_META.test(lead)) return false;
  const ending = lead.at(-1);
  if (ending !== '.' && ending !== '?') return false;
  return !/[.!?。！？]/u.test(lead.slice(0, -1));
}

function fallbackLead(field: ReportField, paragraphIndex: number) {
  const candidates = FALLBACK_LEADS[field];
  return candidates[paragraphIndex % candidates.length];
}

function normalizeParagraph(block: string, field: ReportField, paragraphIndex: number) {
  const match = block.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
  if (match) {
    const oldLead = match[1].replace(/\s+/gu, ' ').trim();
    const rest = match[2].trim();
    if (isShortGuideSentence(oldLead)) return `**${oldLead}**${rest ? ` ${rest}` : ''}`;

    // 긴 결론형 굵은 문장은 버리지 않고 일반 본문 첫 문장으로 되돌립니다.
    const body = `${oldLead} ${rest}`.replace(/\s+/gu, ' ').trim();
    return `**${fallbackLead(field, paragraphIndex)}** ${body}`;
  }

  return `**${fallbackLead(field, paragraphIndex)}** ${block.trim()}`;
}

export function normalizeStoredDetailParagraphGuides(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;

  const normalized: UnknownRecord = { ...record };
  for (const field of REPORT_FIELDS) {
    const text = record[field];
    if (typeof text !== 'string' || !text.trim()) continue;
    normalized[field] = splitParagraphs(text)
      .map((block, paragraphIndex) => normalizeParagraph(block, field, paragraphIndex))
      .join('\n\n');
  }
  return normalized;
}
