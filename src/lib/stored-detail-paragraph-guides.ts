import 'server-only';
import { REPORT_FIELDS, pickFallbackLead, type ReportField } from '@/lib/report-lead-fallbacks';

type UnknownRecord = Record<string, unknown>;


const BANNED_META = /(?:이 문단|다음 항목|분석해보면|리포트상)/u;


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
  // 생성 측(LEAD_EDITOR_SYSTEM)이 8~52자로 만들므로 여기서도 같은 범위를 받아들입니다.
  // 예전에는 32자로 잘라서, AI가 제대로 쓴 33~52자 안내문이 통조림 문구로 바뀌었습니다.
  if (lead.length < 6 || lead.length > 52) return false;
  if (/[,，;；:：]/u.test(lead) || BANNED_META.test(lead)) return false;
  const ending = lead.at(-1);
  if (ending !== '.' && ending !== '?') return false;
  return !/[.!?。！？]/u.test(lead.slice(0, -1));
}


function normalizeParagraph(block: string, field: ReportField, paragraphIndex: number, used: Set<string>) {
  const match = block.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
  if (match) {
    const oldLead = match[1].replace(/\s+/gu, ' ').trim();
    const rest = match[2].trim();
    // 이미 쓴 안내문과 겹치면 그대로 두지 않고 폴백에서 새 문구를 받습니다.
    if (isShortGuideSentence(oldLead) && !used.has(oldLead)) {
      used.add(oldLead);
      return `**${oldLead}**${rest ? ` ${rest}` : ''}`;
    }

    // 긴 결론형 굵은 문장은 버리지 않고 일반 본문 첫 문장으로 되돌립니다.
    const body = `${oldLead} ${rest}`.replace(/\s+/gu, ' ').trim();
    return `**${pickFallbackLead(field, paragraphIndex, used)}** ${body}`;
  }

  return `**${pickFallbackLead(field, paragraphIndex, used)}** ${block.trim()}`;
}

export function normalizeStoredDetailParagraphGuides(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;

  const normalized: UnknownRecord = { ...record };
  for (const field of REPORT_FIELDS) {
    const text = record[field];
    if (typeof text !== 'string' || !text.trim()) continue;
    // 섹션 안에서 같은 안내문이 두 번 나오지 않도록 사용한 문구를 추적합니다.
    const used = new Set<string>();
    normalized[field] = splitParagraphs(text)
      .map((block, paragraphIndex) => normalizeParagraph(block, field, paragraphIndex, used))
      .join('\n\n');
  }
  return normalized;
}
