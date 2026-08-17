import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, initialCharacterDraftSchema } from '@/lib/schemas/character';
import { askOpenAIJson } from '@/lib/ai/openai';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';
import { resolveProfileInput } from '@/lib/profile-source';

const requestSchema = z.object({
  name: z.string().min(1).max(80),
  profileText: z.string().min(1).max(50_000),
  secretProfileText: z.string().max(50_000).optional().default(''),
});

type UnknownRecord = Record<string, unknown>;
type SourceAnchor = {
  id: string;
  layer: 'public' | 'secret';
  text: string;
};

const PARSER_INSTRUCTIONS_V2 = `당신은 자캐커뮤니티 캐릭터 프로필을 구조화하는 분석기입니다.
원본에 명시된 사실과 AI 추론을 엄격히 분리하세요.
캐릭터를 임상적으로 진단하거나 정상/비정상으로 평가하지 마세요.
명시되지 않은 과거 사건, 감정, 관계를 공식 설정처럼 추가하지 마세요.
traits와 relationshipTraits의 수치형 항목은 0~100으로 표현하되 정보가 불충분하면 문자열 "unknown"을 사용하세요.

aiInferences에는 캐릭터 자체에 대한 '한 단계 높은 해석'만 넣으세요.
다음은 aiInferences에 넣지 마세요.
- 공개/비밀 프로필의 이름 표기 차이, 문장 표현, 작성 방식, 정보 누락 등 프로필 문서 자체를 평가하는 내용.
- "명시되지 않았다", "확정하기 어렵다", "정보가 부족하다"처럼 설정 문서의 부족함을 설명하는 내용.
- 프로필에 이미 직접 적힌 성격·행동을 추상적인 말로 바꾸어 반복한 것뿐인 내용.

서버가 프로필의 모든 원문 조각에 fact_### 형식의 ID를 붙여 SOURCE_FACTS로 제공합니다.
AI 추론은 반드시 이 ID들을 근거로 연결해서 만드세요.
- 각 aiInference마다 evidenceIds를 2~4개 넣으세요.
- evidenceIds에는 SOURCE_FACTS에 실제 존재하는 ID만 사용하세요.
- 서로 다른 두 근거를 연결해야만 알 수 있는 내용을 추론하세요. 한 ID만으로 거의 그대로 말할 수 있는 내용은 추론이 아니라 사실에 가깝습니다.
- 추론에 등장하는 조건, 동기, 관계 규칙은 참조한 fact들의 내용에서 직접 뒷받침되거나 여러 fact의 관계에서 자연스럽게 도출되어야 합니다.
- 근거에 없는 "관계의 마찰을 피하려 한다", "통제하려 한다", "버림받는 것을 두려워한다" 같은 그럴듯한 심리 조건을 새로 만들지 마세요.
- 같은 문장을 잘게 나눈 인접 조각만 두 개 골라 근거 수를 채우지 마세요. 의미가 독립적인 단서를 연결하세요.
- 오너가 충분히 '아님'을 누를 수 있을 정도로 해석 여지가 있으면서도, 프로필 근거가 분명한 문장만 제시하세요.

어떤 정보도 종류만 보고 중요하거나 중요하지 않다고 단정하지 마세요. 외형, 물건, 버릇, 숫자, 장소, 신체 특징, 과거 사건, 취향처럼 사소해 보이는 정보도 핵심일 수 있고, 거창한 설정도 행동에는 큰 의미가 없을 수 있습니다.

가능하면 서로 겹치지 않는 해석 후보를 6~10개 만들되, 독립 근거가 부족하면 개수를 억지로 채우지 마세요.
aiInferences는 {text, confidence, evidenceIds} 형태로 출력하고 confidence는 0~100입니다.`;

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

function splitLongFragment(fragment: string) {
  const output: string[] = [];
  let rest = fragment.trim();
  while (rest.length > 240) {
    const window = rest.slice(0, 241);
    const breaks = [
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf(';'),
      window.lastIndexOf('；'),
      window.lastIndexOf(','),
      window.lastIndexOf('，'),
      window.lastIndexOf(' '),
    ];
    const best = Math.max(...breaks);
    const cut = best >= 90 ? best + 1 : 240;
    const piece = rest.slice(0, cut).trim();
    if (piece) output.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) output.push(rest);
  return output;
}

function profileFragments(text: string) {
  const fragments: string[] = [];
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (line.length <= 240) {
      fragments.push(line);
      continue;
    }

    const sentenceParts = line.match(/[^.!?。！？]+[.!?。！？]?/gu) || [line];
    for (const sentence of sentenceParts) {
      const cleaned = sentence.trim();
      if (!cleaned) continue;
      fragments.push(...splitLongFragment(cleaned));
    }
  }
  return fragments;
}

function buildSourceAnchors(publicText: string, secretText: string) {
  const anchors: SourceAnchor[] = [];
  const addLayer = (layer: SourceAnchor['layer'], text: string) => {
    for (const fragment of profileFragments(text)) {
      const id = `fact_${String(anchors.length + 1).padStart(3, '0')}`;
      anchors.push({ id, layer, text: fragment });
    }
  };
  addLayer('public', publicText);
  if (secretText.trim()) addLayer('secret', secretText);
  return anchors;
}

function normalizeEvidenceIds(record: UnknownRecord, anchorMap: Map<string, SourceAnchor>) {
  const raw = record.evidenceIds ?? record.evidence_ids ?? record.factIds ?? record.fact_ids ?? record.evidence;
  const array = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return [...new Set(array
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(id => anchorMap.has(id)))]
    .slice(0, 4);
}

function normalizeInferences(items: unknown[], anchors: SourceAnchor[]) {
  const anchorMap = new Map(anchors.map(anchor => [anchor.id, anchor]));
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!Object.keys(record).length) return [];
    const text = pickString(record, ['text', 'inference', 'hypothesis', 'summary', 'content', 'description', 'claim', 'interpretation']);
    if (!text || isDocumentMetaInference(text)) return [];

    const evidenceIds = normalizeEvidenceIds(record, anchorMap);
    if (evidenceIds.length < 2) return [];
    const evidence = evidenceIds.map(id => anchorMap.get(id)!.text);

    const confidence = normalizeScore(record.confidence ?? record.score ?? record.probability ?? record.certainty, 60);
    return [{
      id: `inf_${index + 1}`,
      text,
      confidence,
      evidenceIds,
      evidence,
      ownerVerdict: 'unreviewed' as const,
    }];
  }).slice(0, 24);
}

export async function POST(request: Request) {
  try {
    await assertRateLimit('character_parse', 10, 30);
    const body = requestSchema.parse(await request.json());
    const [publicSource, secretSource] = await Promise.all([
      resolveProfileInput(body.profileText, true),
      resolveProfileInput(body.secretProfileText, false),
    ]);
    const profileText = publicSource.text;
    const secretProfileText = secretSource.text;

    const sourceAnchors = buildSourceAnchors(profileText, secretProfileText);

    const raw = await askOpenAIJson({
      instructions: PARSER_INSTRUCTIONS_V2,
      schema: initialCharacterDraftSchema,
      maxOutputTokens: 3600,
      input: `캐릭터 이름: ${body.name}\n\nSOURCE_FACTS — 서버가 공개/비밀 프로필 원문 순서대로 만든 근거 ID 목록입니다:\n${JSON.stringify(sourceAnchors)}\n\n위 SOURCE_FACTS가 이번 분석의 전체 프로필 입력입니다. layer=public은 공개 프로필, layer=secret은 비밀 프로필입니다.\n공개와 비밀 정보층의 차이는 캐릭터 해석에 활용할 수 있지만, 문서 표기 차이나 누락 자체를 aiInference로 만들지는 마세요.\n\nJSON에는 basicProfile, traits, relationshipTraits, confirmedFacts, aiInferences, analysisConfidence를 넣으세요.\nbasicProfile에는 age와 gender 정도만 넣어도 됩니다. name/profileText/secretProfileText는 서버가 직접 보존합니다.\nconfirmedFacts는 가능한 한 {key, value} 배열로 출력하세요.\naiInferences는 반드시 {text, confidence, evidenceIds} 배열로 출력하세요. evidenceIds는 SOURCE_FACTS에 실제 존재하는 서로 다른 fact ID 2~4개입니다. id와 ownerVerdict는 서버가 생성합니다.`,
    });

    const basic = asRecord(raw.basicProfile);
    const draft = characterDraftSchema.parse({
      basicProfile: {
        name: body.name,
        age: basic.age ?? null,
        gender: typeof basic.gender === 'string' ? basic.gender : null,
        profileText,
        ...(secretProfileText.trim() ? { secretProfileText } : {}),
      },
      traits: normalizeTraitRecord(raw.traits),
      relationshipTraits: normalizeTraitRecord(raw.relationshipTraits),
      confirmedFacts: normalizeFacts(raw.confirmedFacts),
      aiInferences: normalizeInferences(raw.aiInferences, sourceAnchors),
      analysisConfidence: normalizeScore(raw.analysisConfidence, 65),
    });

    return NextResponse.json({ draft });
  } catch (error) {
    return apiError(error);
  }
}
