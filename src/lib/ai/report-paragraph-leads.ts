import { z } from 'zod';
import { generateValidatedJson } from '@/lib/ai/json';
import { REPORT_FIELDS, pickFallbackLead, type ReportField } from '@/lib/report-lead-fallbacks';
import { logGenRetry } from '@/lib/ai/usage';
import { applyName } from '@/lib/josa';

type UnknownRecord = Record<string, unknown>;

type ParagraphItem = {
  id: string;
  field: ReportField;
  paragraphIndex: number;
  sectionTitle: string;
  body: string;
};

const BANNED_META = /(?:이 문단|다음 항목|분석해보면|리포트상|결론은|핵심은)/u;
const SENTENCE_LIKE_ENDING = /(?:볼게요|살펴볼게요|들여다볼게요|짚어볼게요|이어볼게요|확인해볼게요|생각해볼게요|해요|보여요|있어요|없어요|돼요|이에요|예요|할까요|일까요|될까요|볼까요|합니다|습니다|한다|이다|했다|된다)$/u;
const GUIDE_VERBS = /(?:살펴볼|들여다볼|짚어볼|이어볼|확인해볼|생각해볼|알아볼|보도록|살펴보)/u;

function topicTitleReason(value: string) {
  const title = value.replace(/\s+/gu, ' ').trim();
  if (!title) return '소항목 제목이 비어 있음';
  if (title.includes('**') || /[\r\n]/u.test(value)) return 'Markdown 또는 줄바꿈 포함';
  if (title.length < 2 || title.length > 40) return '소항목 제목은 2~40자여야 함';
  if (title.split(/\s+/u).length > 10) return '소항목 제목은 10어절 이하의 짧은 명사구여야 함';
  if (/[,，;；:：.!?。！？]/u.test(title)) return '문장부호 금지';
  if (BANNED_META.test(title)) return '문서 구조를 드러내는 표현 금지';
  if (SENTENCE_LIKE_ENDING.test(title) || GUIDE_VERBS.test(title)) return '완결문·질문형·안내문이 아니라 명사형 제목이어야 함';
  return '';
}

// 제목이 규칙에서 조금 벗어났을 때, 배치 전체를 다시 생성하지 않고 코드로 다듬는다.
// 재생성은 프롬프트를 통째로 다시 보내 비용이 두 배가 되므로, 뜻을 바꾸지 않고
// 고칠 수 있는 위반(문장부호, 별표, 안내문 종결, 길이)은 여기서 처리한다.
// 새 제목을 창작하지는 않는다 — 고칠 수 없으면 빈 문자열을 돌려 폴백 제목이 쓰이게 한다.
export function repairTopicTitle(value: string) {
  let title = value.replace(/\*\*/gu, '').replace(/\s+/gu, ' ').trim();
  if (!title) return '';
  // 끝의 문장부호를 먼저 떼어내야 "~일까요?" 같은 종결 패턴이 잡힌다.
  title = title.replace(/[.!?。！？]+\s*$/u, '').trim();
  // 안내문 종결·질문형을 명사형으로 되돌린다: "~를 살펴볼게요" → "~"
  title = title
    .replace(/(?:도|를|을|은|는|이|가)?\s*(?:한번\s*)?(?:같이\s*)?(?:살펴|들여다|짚어|이어|확인해|생각해|알아)(?:볼게요|볼까요|보도록\s*할게요|봅니다|보죠|보자)\s*$/u, '')
    .replace(/(?:이|일|할|될|볼)?까요\s*$/u, '')
    .trim();
  // 남은 문장부호 제거(제목에는 쓰지 않는다).
  title = title.replace(/[,，;；:：.!?。！？]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  // 어절이 너무 길면 앞쪽 10어절만 남긴다.
  const words = title.split(/\s+/u);
  if (words.length > 10) title = words.slice(0, 10).join(' ');
  if (title.length > 40) title = title.slice(0, 40).trim();
  return topicTitleReason(title) ? '' : title;
}

const topicTitleSchema = z.object({
  lead: z.string(),
}).transform(value => {
  // 규칙에 맞으면 그대로, 아니면 보정해서 통과시킨다. 보정 불가면 빈 문자열이 되고
  // 호출부에서 폴백 제목으로 대체되므로, 이 단계 때문에 재생성이 발생하지 않는다.
  const lead = value.lead.replace(/\s+/gu, ' ').trim();
  return { lead: topicTitleReason(lead) ? repairTopicTitle(lead) : lead };
});

function leadBatchSchema(length: number) {
  return z.object({
    leads: z.array(topicTitleSchema).length(length),
  });
}

const LEAD_EDITOR_SYSTEM = `당신은 이미 완성된 긴 캐릭터 해석문의 각 문단에 붙을 "소항목 제목"만 다듬는 한국어 편집자입니다.
본문은 절대 수정하거나 요약하지 마세요. 각 문단을 읽고, 그 문단의 화제를 한눈에 알아볼 수 있는 짧고 깔끔한 제목만 작성하세요.

소항목 제목은 문장이 아니라 책이나 잡지의 소제목처럼 보이는 명사형·단문형이어야 합니다.

좋은 결:
- 루카의 본질
- 전체적인 인상
- 겉으로 보이는 모습과 실제 내면
- 자기 인식과 타인의 시선 사이의 격차
- 자기 자신을 바라보는 방식
- 타인의 인상과 어긋나는 지점
- 관계를 시작하는 방식
- 친밀감이 깊어질수록 생기는 변화
- 원하는 것과 실제로 필요한 것
- 갈등에서 끝까지 지키는 기준

반드시 지킬 규칙:
- 완결된 문장형 제목을 쓰지 않습니다.
- "~볼게요", "~살펴볼게요", "~일까요?", "~해요", "~이에요" 같은 상담 안내문·질문형 종결을 쓰지 않습니다.
- 마침표·물음표·느낌표·쉼표·쌍점·세미콜론을 쓰지 않습니다.
- 2~40자, 최대 10어절의 짧은 명사구를 우선합니다.
- 본문의 결론 전체를 길게 요약하지 말고, 그 문단에서 다루는 핵심 화제만 제목으로 뽑습니다.
- 캐릭터 이름을 쓰면 자연스러운 경우에만 사용합니다. 모든 제목에 이름을 반복하지 않습니다.
- 같은 섹션 안에서 뜻과 표현이 겹치는 제목을 반복하지 않습니다.
- Markdown 별표는 넣지 않습니다. 서버가 굵게 표시합니다.
- "이 문단에서는", "분석해보면", "리포트상" 같은 문서 구조 표현을 사용하지 않습니다.

나쁜 예:
- 루카는 본질적으로 어떤 사람일까요?
- 먼저 이 캐릭터의 전체 인상부터 살펴볼게요.
- 겉으로 보이는 모습과 실제 내면은 어떻게 다를까요?
- 자기 자신을 바라보는 방식도 조금 더 들여다볼게요.
- 타인의 인상과 어디에서 어긋나는지도 볼게요.`;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function sectionTitle(field: ReportField, name: string) {
  if (field === 'characterOverview') return applyName('{name}는 이런 캐릭터예요', name);
  if (field === 'innerMechanics') return applyName('{name}는 이렇게 작동해요', name);
  if (field === 'relationshipStyle') return applyName('{name}는 이렇게 관계를 맺어요', name);
  if (field === 'attachmentStyle') return applyName('{name}는 이런 애착이 있어요', name);
  if (field === 'conflictStyleDetailed') return applyName('{name}는 이렇게 갈등해요', name);
  if (field === 'charmAndContradictions') return applyName('{name}에겐 이런 매력이 있어요', name);
  return '통합 리포트';
}

function splitParagraphs(text: string) {
  return text
    .replace(/\r\n?/gu, '\n')
    .trim()
    .split(/\n{2,}/u)
    .map(block => block.replace(/[ \t]+/gu, ' ').replace(/\n+/gu, ' ').trim())
    .filter(Boolean);
}

function existingLeadLooksLikeTopicTitle(lead: string) {
  return !topicTitleReason(lead);
}

function paragraphBody(block: string) {
  const match = block.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
  if (!match) return block.trim();

  const oldLead = match[1].replace(/\s+/gu, ' ').trim();
  const rest = match[2].trim();
  if (existingLeadLooksLikeTopicTitle(oldLead)) return rest || oldLead;

  // 예전 문장형 안내문이나 실제 해석 문장을 버리지 않고 일반 본문으로 돌립니다.
  return `${oldLead} ${rest}`.replace(/\s+/gu, ' ').trim();
}

function bodyPreview(body: string) {
  const compact = body.replace(/\s+/gu, ' ').trim();
  if (compact.length <= 520) return compact;
  return `${compact.slice(0, 420).trimEnd()} … ${compact.slice(-80).trimStart()}`;
}

function buildItems(record: UnknownRecord, name: string) {
  const items: ParagraphItem[] = [];
  for (const field of REPORT_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    const title = sectionTitle(field, name);
    const blocks = splitParagraphs(value);
    blocks.forEach((block, paragraphIndex) => {
      const existingLead = block.match(/^\*\*(.+?)\*\*/su)?.[1]?.replace(/\s+/gu, ' ').trim() || '';
      // 작성 단계에서 이미 규칙에 맞는 명사형 소항목 제목이 붙었으면 그대로 둔다.
      if (existingLead && existingLeadLooksLikeTopicTitle(existingLead)) return;
      items.push({
        id: `${field}:${paragraphIndex}`,
        field,
        paragraphIndex,
        sectionTitle: title,
        body: paragraphBody(block),
      });
    });
  }
  return items;
}

function promptForItems(name: string, items: ParagraphItem[]) {
  const source = items.map((item, index) => [
    `[${index + 1}]`,
    `중항목: ${item.sectionTitle}`,
    `본문 발췌: ${bodyPreview(item.body)}`,
  ].join('\n')).join('\n\n');

  return `캐릭터 이름: ${name}\n\n아래 ${items.length}개 문단에 대해 같은 순서로 소항목 제목을 하나씩 작성하세요.\n문장형 안내문이 아니라 짧은 명사형 제목만 출력하세요. 본문은 다시 쓰지 마세요.\n\n${source}`;
}

export async function rewriteDetailedReportParagraphLeads<T>(value: T, model: string): Promise<T> {
  const record = asRecord(value);
  if (!record) return value;

  const name = typeof record.name === 'string' && record.name.trim()
    ? record.name.trim()
    : '이 캐릭터';
  const items = buildItems(record, name);
  if (!items.length) return value;

  let leads: string[];
  try {
    const result = await generateValidatedJson({
      model,
      system: LEAD_EDITOR_SYSTEM,
      prompt: promptForItems(name, items),
      schema: leadBatchSchema(items.length),
      maxOutputTokens: Math.max(700, Math.min(2600, 220 + items.length * 65)),
      // 제목 위반은 이제 스키마 단계에서 보정되고, 보정 불가면 폴백 제목이 쓰인다.
      // 그래서 형식 때문에 다시 생성할 이유가 없다(타입/도구 실패만 남는데 그건 재시도해도
      // 같은 결과일 확률이 높고, 실패해도 폴백으로 리포트가 완성된다).
      maxAttempts: 1,
    });
    leads = result.leads.map(item => item.lead.replace(/\s+/gu, ' ').trim());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('DETAIL_PARAGRAPH_LEAD_REWRITE_FAILED', error);
    // 소제목 생성이 통째로 실패하면 폴백 제목이 쓰인다. 관리자 화면에서 보이도록 남긴다.
    logGenRetry('LEAD_REWRITE_FAILED', `문단 ${items.length}개 / ${message}`);
    leads = [];
  }

  // 같은 중항목 안에서 소항목 제목이 겹치지 않게 배정합니다.
  const usedByField = new Map<string, Set<string>>();
  const leadById = new Map(items.map((item, index) => {
    if (!usedByField.has(item.field)) usedByField.set(item.field, new Set());
    const used = usedByField.get(item.field)!;
    const candidate = (leads[index] || '').trim();
    if (candidate && !used.has(candidate)) { used.add(candidate); return [item.id, candidate] as const; }
    return [item.id, pickFallbackLead(item.field, item.paragraphIndex, used)] as const;
  }));
  const rewritten: UnknownRecord = { ...record };

  for (const field of REPORT_FIELDS) {
    const valueForField = record[field];
    if (typeof valueForField !== 'string' || !valueForField.trim()) continue;
    const blocks = splitParagraphs(valueForField);
    const used = usedByField.get(field) ?? new Set<string>();
    usedByField.set(field, used);
    rewritten[field] = blocks.map((block, paragraphIndex) => {
      const body = paragraphBody(block);
      const id = `${field}:${paragraphIndex}`;
      const item = items.find(candidate => candidate.id === id);
      if (!item) {
        const existingLead = block.match(/^\*\*(.+?)\*\*/su)?.[1]?.replace(/\s+/gu, ' ').trim();
        if (existingLead) { used.add(existingLead); return `**${existingLead}** ${body}`.trim(); }
        return `**${pickFallbackLead(field, paragraphIndex, used)}** ${body}`.trim();
      }
      const lead = leadById.get(id) || pickFallbackLead(field, paragraphIndex, used);
      return `**${lead}** ${body}`.trim();
    }).join('\n\n');
  }

  return rewritten as T;
}
