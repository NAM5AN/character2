import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, initialCharacterDraftSchema } from '@/lib/schemas/character';
import { askOpenAIJson } from '@/lib/ai/openai';
import { PARSER_INSTRUCTIONS } from '@/lib/ai/prompts';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  name: z.string().min(1).max(80),
  profileText: z.string().min(20).max(50_000),
  secretProfileText: z.string().max(50_000).optional().default(''),
  accessCode: z.string().min(1),
});

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function pickString(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeScore(value: unknown, fallback = 60) {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace('%', '').trim()) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const scaled = n >= 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function normalizeTraitRecord(value: unknown): Record<string, number | string | boolean | null> {
  const input = asRecord(value);
  const output: Record<string, number | string | boolean | null> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') output[key] = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) output[key] = Math.max(0, Math.min(100, raw));
    else if (raw !== undefined) {
      try { output[key] = JSON.stringify(raw); } catch { output[key] = String(raw); }
    }
  }
  return output;
}

function normalizeFacts(items: unknown[]) {
  return items.flatMap((item, index) => {
    if (typeof item === 'string' && item.trim()) {
      return [{ key: `fact_${index + 1}`, value: item.trim(), source: 'profile' as const }];
    }
    const record = asRecord(item);
    if (!Object.keys(record).length) return [];
    const key = pickString(record, ['key', 'label', 'name', 'topic', 'field']) || `fact_${index + 1}`;
    const value = record.value ?? record.text ?? record.fact ?? record.content ?? record.description ?? record.detail;
    if (value === undefined || value === null || value === '') return [];
    return [{ key, value, source: 'profile' as const }];
  }).slice(0, 80);
}

function isDocumentMetaInference(text: string) {
  const normalized = text.replace(/\s+/g, ' ');
  const patterns = [
    /공개\s*프로필|비밀\s*프로필|비공개\s*프로필/,
    /프로필.{0,24}(표기|문서|작성|정보|누락|불일치|차이|명시|확정)/,
    /(이름|인식표|표기).{0,24}(차이|불일치|다르|상이)/,
    /정보층|문서상|설정상.{0,16}(명시되지|확정하기 어렵|정보가 부족)/,
    /명시되지 않았|확정하기 어렵|정보가 부족|판단하기 어렵/,
  ];
  return patterns.some(pattern => pattern.test(normalized));
}

function normalizeForEvidenceMatch(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[“”‘’"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEvidence(record: UnknownRecord, sourceText: string) {
  const raw = record.evidence ?? record.evidences ?? record.grounds ?? record.basis ?? record.sources ?? record.anchors;
  const array = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const normalizedSource = normalizeForEvidenceMatch(sourceText);

  return [...new Set(array
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
    .filter(item => {
      const normalized = normalizeForEvidenceMatch(item);
      return normalized.length >= 4 && normalizedSource.includes(normalized);
    }))]
    .slice(0, 4);
}

function normalizeInferences(items: unknown[], sourceText: string) {
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!Object.keys(record).length) return [];
    const text = pickString(record, ['text', 'inference', 'hypothesis', 'summary', 'content', 'description', 'claim', 'interpretation']);
    if (!text || isDocumentMetaInference(text)) return [];

    const evidence = normalizeEvidence(record, sourceText);
    // New review cards require at least two distinct excerpts that the server
    // can verify actually exist in the supplied public/secret profile text.
    if (evidence.length < 2) return [];

    const confidence = normalizeScore(record.confidence ?? record.score ?? record.probability ?? record.certainty, 60);
    return [{
      id: `inf_${index + 1}`,
      text,
      confidence,
      evidence,
      ownerVerdict: 'unreviewed' as const,
    }];
  }).slice(0, 24);
}

export async function POST(request: Request) {
  try {
    await assertRateLimit('character_parse', 10, 30);
    const body = requestSchema.parse(await request.json());
    if (!(await validateAccessCode(body.accessCode))) throw new Error('CODE_INVALID');

    const secretSection = body.secretProfileText.trim()
      ? `\n\n비밀 프로필:\n${body.secretProfileText}`
      : '\n\n비밀 프로필: 없음';

    const raw = await askOpenAIJson({
      instructions: PARSER_INSTRUCTIONS,
      schema: initialCharacterDraftSchema,
      maxOutputTokens: 3000,
      input: `캐릭터 이름: ${body.name}\n\n공개 프로필:\n${body.profileText}${secretSection}\n\n공개 프로필과 비밀 프로필은 서로 다른 정보층으로 읽되, aiInferences에는 문서의 차이·누락·표기 문제를 적지 말고 캐릭터 자체의 행동 규칙·관계 방식·가치·동기에 대한 해석만 적으세요.\n\n중요: aiInferences는 프로필 문장을 다시 말하는 요약이 아닙니다. 서로 다른 프로필 단서 2개 이상을 연결했을 때만 한 단계 높은 해석을 만드세요. 추론에 등장하는 모든 조건·동기·관계 규칙은 evidence에서 직접 뒷받침되거나 evidence 사이의 관계에서 자연스럽게 나와야 합니다. 근거 없는 심리 조건을 새로 만들지 마세요.\n\nJSON에는 basicProfile, traits, relationshipTraits, confirmedFacts, aiInferences, analysisConfidence를 넣으세요.\nbasicProfile에는 age와 gender 정도만 넣어도 됩니다. name/profileText/secretProfileText는 서버가 직접 보존합니다.\nconfirmedFacts는 가능한 한 {key, value} 배열로 출력하세요.\naiInferences는 반드시 {text, confidence, evidence} 배열로 출력하세요. evidence는 요약문이 아니라 공개/비밀 프로필 원문에 실제로 존재하는 짧은 구절을 그대로 발췌한 문자열 2~4개여야 합니다. 서버가 원문에 실제로 존재하는지 검사합니다. id와 ownerVerdict는 서버가 생성합니다.`,
    });

    const basic = asRecord(raw.basicProfile);
    const sourceText = `${body.profileText}\n${body.secretProfileText}`;
    const draft = characterDraftSchema.parse({
      basicProfile: {
        name: body.name,
        age: basic.age ?? null,
        gender: typeof basic.gender === 'string' ? basic.gender : null,
        profileText: body.profileText,
        ...(body.secretProfileText.trim() ? { secretProfileText: body.secretProfileText } : {}),
      },
      traits: normalizeTraitRecord(raw.traits),
      relationshipTraits: normalizeTraitRecord(raw.relationshipTraits),
      confirmedFacts: normalizeFacts(raw.confirmedFacts),
      aiInferences: normalizeInferences(raw.aiInferences, sourceText),
      analysisConfidence: normalizeScore(raw.analysisConfidence, 65),
    });

    return NextResponse.json({ draft });
  } catch (error) {
    return apiError(error);
  }
}
