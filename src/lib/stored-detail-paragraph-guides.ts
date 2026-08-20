import 'server-only';
import { REPORT_FIELDS, pickFallbackLead, type ReportField } from '@/lib/report-lead-fallbacks';

type UnknownRecord = Record<string, unknown>;

const BANNED_META = /(?:이 문단|다음 항목|분석해보면|리포트상|결론은|핵심은)/u;
const SENTENCE_LIKE_ENDING = /(?:볼게요|살펴볼게요|들여다볼게요|짚어볼게요|이어볼게요|확인해볼게요|생각해볼게요|해요|보여요|있어요|없어요|돼요|이에요|예요|할까요|일까요|될까요|볼까요|합니다|습니다|한다|이다|했다|된다)$/u;
const GUIDE_VERBS = /(?:살펴볼|들여다볼|짚어볼|이어볼|확인해볼|생각해볼|알아볼|보도록|살펴보)/u;

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

function isShortTopicTitle(value: string) {
  const title = value.replace(/\s+/gu, ' ').trim();
  if (title.length < 2 || title.length > 40) return false;
  if (title.split(/\s+/u).length > 10) return false;
  if (/[,，;；:：.!?。！？]/u.test(title) || BANNED_META.test(title)) return false;
  if (SENTENCE_LIKE_ENDING.test(title) || GUIDE_VERBS.test(title)) return false;
  return true;
}

function normalizeParagraph(block: string, field: ReportField, paragraphIndex: number, used: Set<string>) {
  const match = block.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
  if (match) {
    const oldLead = match[1].replace(/\s+/gu, ' ').trim();
    const rest = match[2].trim();
    // 이미 짧은 명사형 소항목 제목이면 그대로 유지한다.
    if (isShortTopicTitle(oldLead) && !used.has(oldLead)) {
      used.add(oldLead);
      return `**${oldLead}**${rest ? ` ${rest}` : ''}`;
    }

    // 예전 문장형 안내문이나 긴 굵은 문장은 버리지 않고 본문 첫 문장으로 되돌리고,
    // 제목 자리에는 짧은 명사형 폴백 제목을 사용한다.
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
    const used = new Set<string>();
    normalized[field] = splitParagraphs(text)
      .map((block, paragraphIndex) => normalizeParagraph(block, field, paragraphIndex, used))
      .join('\n\n');
  }
  return normalized;
}
