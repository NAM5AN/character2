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

function normalizeInferences(items: unknown[]) {
  return items.flatMap((item, index) => {
    if (typeof item === 'string' && item.trim()) {
      return [{ id: `inf_${index + 1}`, text: item.trim(), confidence: 60, ownerVerdict: 'unreviewed' as const }];
    }
    const record = asRecord(item);
    if (!Object.keys(record).length) return [];
    const text = pickString(record, ['text', 'inference', 'hypothesis', 'summary', 'content', 'description', 'claim', 'interpretation']);
    if (!text) return [];
    const confidence = normalizeScore(record.confidence ?? record.score ?? record.probability ?? record.certainty, 60);
    return [{ id: `inf_${index + 1}`, text, confidence, ownerVerdict: 'unreviewed' as const }];
  }).slice(0, 40);
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
      maxOutputTokens: 3200,
      input: `캐릭터 이름: ${body.name}\n\n공개 프로필:\n${body.profileText}${secretSection}\n\n공개 프로필과 비밀 프로필을 서로 다른 정보층으로 인식해 함께 분석하세요. 둘 사이의 차이·숨겨진 동기·겉과 속의 간극을 한쪽으로 지워 합치지 마세요.\n\nJSON에는 basicProfile, traits, relationshipTraits, confirmedFacts, aiInferences, analysisConfidence를 넣으세요.\nbasicProfile에는 age와 gender 정도만 넣어도 됩니다. name/profileText/secretProfileText는 서버가 직접 보존하므로 출력하지 않아도 됩니다.\nconfirmedFacts는 가능한 한 {key, value} 배열로, aiInferences는 가능한 한 {text, confidence} 배열로 출력하세요. id와 ownerVerdict는 서버가 생성합니다.`,
    });

    const basic = asRecord(raw.basicProfile);
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
      aiInferences: normalizeInferences(raw.aiInferences),
      analysisConfidence: normalizeScore(raw.analysisConfidence, 65),
    });

    return NextResponse.json({ draft });
  } catch (error) {
    return apiError(error);
  }
}
