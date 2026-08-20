import { z } from 'zod';
import { generateValidatedJson } from '@/lib/ai/json';
import { REPORT_FIELDS, pickFallbackLead, type ReportField } from '@/lib/report-lead-fallbacks';
import { logGenRetry } from '@/lib/ai/usage';
import { applyName } from '@/lib/josa';

type UnknownRecord = Record<string, unknown>;

type LeadStyle = 'A' | 'C';

type ParagraphItem = {
  id: string;
  field: ReportField;
  paragraphIndex: number;
  sectionTitle: string;
  body: string;
};

const QUESTION_WORDS = /(?:어떻게|무엇|어떤|왜|언제|어디|얼마나|누구|달라질|바랄|움직일|반응할|느낄|쌓일|남을|이어질|정리할|잘 맞을|힘들어할|드러날|변할|보일|필요할|지킬|향할)/u;
const GUIDE_WORDS = /(?:볼게요|살펴볼게요|들여다볼게요|짚어볼게요|이어볼게요|확인해볼게요|생각해볼게요|부분이에요|지점이에요|지점이 있어요|차례예요|이야기예요|면이 드러날 수 있어요|달라지는 부분이 있어요|오해가 생기기 쉬워요|인상은 오래가지 않아요|흐름을 볼게요)/u;
const TRANSITION_START = /^(?:그런데|그래서|이때|반면|여기서|다만|결국|그렇다면|조금 더 가까이 보면)/u;
const BANNED_META = /(?:이 문단|다음 항목|분석해보면|리포트상|결론은|핵심은|본질은)/u;

function guideLeadReason(value: string, style: LeadStyle) {
  const lead = value.replace(/\s+/gu, ' ').trim();
  if (!lead) return '안내문이 비어 있음';
  if (lead.includes('**') || /[\r\n]/u.test(value)) return 'Markdown 또는 줄바꿈 포함';
  if (lead.length < 8 || lead.length > 52) return '안내문은 8~52자여야 함';
  if (/[,，;；:：]/u.test(lead)) return '짧은 한 문장이어야 하므로 쉼표·쌍점 금지';
  if (BANNED_META.test(lead)) return '문서 구조나 결론을 드러내는 표현 금지';

  const ending = lead.at(-1);
  if (ending !== '.' && ending !== '?') return '마침표 또는 물음표로 끝나야 함';
  if (/[.!?。！？]/u.test(lead.slice(0, -1))) return '안내문은 한 문장만 허용';

  if (style === 'C') {
    if (ending !== '?') return 'C형은 질문형이어야 함';
    if (!QUESTION_WORDS.test(lead)) return 'C형에는 독자가 궁금해할 질문 표현이 필요함';
    return '';
  }

  if (ending !== '.') return 'A형은 안내형 문장이어야 함';
  if (!GUIDE_WORDS.test(lead) && !TRANSITION_START.test(lead)) {
    return 'A형은 화제를 안내하거나 짧게 전환하는 문장이어야 함';
  }
  return '';
}

const guideLeadSchema = z.object({
  style: z.enum(['A', 'C']),
  lead: z.string(),
}).superRefine((value, context) => {
  const reason = guideLeadReason(value.lead, value.style);
  if (reason) context.addIssue({ code: 'custom', path: ['lead'], message: reason });
});

function leadBatchSchema(length: number) {
  return z.object({
    leads: z.array(guideLeadSchema).length(length),
  }).superRefine((value, context) => {
    if (length < 4) return;
    const styles = value.leads.map(item => item.style);
    if (!styles.includes('A') || !styles.includes('C')) {
      context.addIssue({ code: 'custom', path: ['leads'], message: 'A형과 C형을 자연스럽게 섞어야 함' });
    }
    if (styles.every((style, index) => index === 0 || style !== styles[index - 1])) {
      context.addIssue({ code: 'custom', path: ['leads'], message: 'A-C-A-C 식의 기계적인 교대 금지' });
    }
    let run = 1;
    for (let index = 1; index < styles.length; index += 1) {
      run = styles[index] === styles[index - 1] ? run + 1 : 1;
      if (run > 3) {
        context.addIssue({ code: 'custom', path: ['leads', index], message: '같은 형식은 최대 3개까지만 연속 사용' });
        break;
      }
    }
  });
}

const LEAD_EDITOR_SYSTEM = `당신은 이미 완성된 긴 캐릭터 해석문의 문단 첫 안내문만 다듬는 한국어 편집자입니다.
본문은 절대 수정하거나 요약하지 마세요. 각 문단의 내용을 읽고, 독자가 그 문단에서 무엇을 다루는지만 빠르게 알 수 있는 짧은 안내문 한 문장만 작성하세요.

요약 리포트에서 사용되는 문단 첫 문장과 같은 결을 따라야 합니다.

A형 — 상담사가 다음 화제를 자연스럽게 안내하는 짧은 문장
- 첫인상부터 살펴볼게요.
- 거리를 좁히는 방식부터 볼게요.
- 평소와 다르게 반응하는 지점이 있어요.
- 멀리 떨어진 단서 두 개를 이어볼게요.

C형 — 독자가 궁금해할 질문을 바로 던지는 짧은 문장
- 속에서 무엇이 움직이고 있을까요?
- 신뢰는 어떤 조건에서 쌓일까요?
- 좋아하는 사람 앞에서는 어떻게 달라질까요?
- 결국 무엇을 지키려는 걸까요?

반드시 지킬 규칙:
- 안내문은 본문의 결론이나 성격 해석을 미리 요약하지 않습니다.
- 안내문만 읽으면 ‘이 문단은 질투 이야기구나 / 과거 영향 이야기구나’ 정도만 알 수 있어야 합니다.
- 각 문단에는 A형 또는 C형 중 하나만 사용합니다.
- A-C-A-C처럼 규칙적으로 번갈아 쓰지 않습니다. 같은 형식이 2~3개 연속되어도 자연스러우면 괜찮습니다.
- 8~52자의 짧은 한 문장으로 씁니다.
- 쉼표·쌍점·세미콜론을 사용하지 않습니다.
- Markdown 별표는 넣지 않습니다. 서버가 굵게 표시합니다.
- ‘이 문단에서는’, ‘분석해보면’, ‘리포트상’ 같은 문서 구조 표현을 사용하지 않습니다.

나쁜 예:
- 시아는 반응이 돌아오는 관계를 원해요. (해석 결론을 미리 말함)
- 시아가 스스로를 어떻게 이해하는지를 보면 자기 인식과 실제 행동 사이에 뚜렷한 틈이 있어요. (길고 결론을 요약함)
- 표면적인 자기서술과 실제로 반복되는 행동을 나란히 놓아보면 더 선명해지는 부분이 있어요. (본문을 요약하는 긴 분석문)
- 시아는 가까운 사람에게 무엇을 바랄까요? 그 관계에서 중요한 지점부터 볼게요. (질문형과 안내형을 합침)`;

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

function existingLeadLooksLikeGuide(lead: string) {
  const style: LeadStyle = lead.trim().endsWith('?') ? 'C' : 'A';
  return !guideLeadReason(lead, style);
}

function paragraphBody(block: string) {
  const match = block.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
  if (!match) return block.trim();

  const oldLead = match[1].replace(/\s+/gu, ' ').trim();
  const rest = match[2].trim();
  if (existingLeadLooksLikeGuide(oldLead)) return rest || oldLead;

  // 기존 굵은 문장이 실제 해석 결론이었다면 내용을 버리지 않고 일반 본문으로 돌립니다.
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
      // 작성 단계에서 이미 규칙에 맞는 안내문이 붙었으면 재작성하지 않고 그대로 둔다(추가 호출 절약).
      if (existingLead && existingLeadLooksLikeGuide(existingLead)) return;
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
    `섹션: ${item.sectionTitle}`,
    `본문 발췌: ${bodyPreview(item.body)}`,
  ].join('\n')).join('\n\n');

  return `캐릭터 이름: ${name}\n\n아래 ${items.length}개 문단에 대해 같은 순서로 안내문을 하나씩 작성하세요.\n본문을 다시 쓰거나 요약하지 말고 문단의 화제 범위만 알려주세요.\n\n${source}`;
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
      maxOutputTokens: Math.max(900, Math.min(3200, 300 + items.length * 90)),
      maxAttempts: 2,
    });
    leads = result.leads.map(item => item.lead.replace(/\s+/gu, ' ').trim());
  } catch (error) {
    // 이 실패는 조용히 폴백으로 흡수돼 왔습니다. 그 결과 리포트 제목이 통조림 문구로
    // 바뀌고 중복까지 생겼는데, 콘솔에만 남아 원인을 추적할 수 없었습니다.
    // 관리자 콘솔에서 보이도록 기록합니다(생성 자체는 폴백으로 계속 진행).
    const message = error instanceof Error ? error.message : String(error);
    console.error('DETAIL_PARAGRAPH_LEAD_REWRITE_FAILED', error);
    logGenRetry('LEAD_REWRITE_FAILED', `문단 ${items.length}개 / ${message}`);
    leads = [];
  }

  // 같은 섹션 안에서 안내문이 겹치지 않게 배정합니다. AI가 겹쳐 쓴 경우와
  // 폴백이 순환하는 경우 모두 여기서 걸러집니다.
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
    // 위에서 배정하며 쓴 문구를 그대로 이어받아, 이 루프에서 고르는 폴백도 겹치지 않게 한다.
    const used = usedByField.get(field) ?? new Set<string>();
    usedByField.set(field, used);
    rewritten[field] = blocks.map((block, paragraphIndex) => {
      const body = paragraphBody(block);
      const id = `${field}:${paragraphIndex}`;
      const item = items.find(candidate => candidate.id === id);
      if (!item) {
        // 재작성 대상이 아니었던 문단 = 기존 안내문이 이미 규칙에 맞음 → 그대로 유지
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
