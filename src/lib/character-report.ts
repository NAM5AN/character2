import { z } from 'zod';
import { personalityTagStateSchema, summaryCardLinesSchema, type CharacterPassport } from '@/lib/schemas/character';

export const characterReportPreviewSchema = z.object({
  name: z.string().min(1),
  ownerName: z.string().min(1).max(80).nullable().optional(),
  shareCode: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
  oneLineSummary: z.string(),
  summary: z.object({
    outerSelf: z.string(),
    innerSelf: z.string(),
    conflictStyle: z.string(),
    affectionStyle: z.string(),
    misunderstoodPoint: z.string().optional(),
    hiddenPattern: z.string().optional(),
  }),
  // 아래 세 필드는 구버전 캐릭터엔 없을 수 있다. character2_get_public_preview 는
  // 값이 없을 때 키를 빼는 게 아니라 JSON null 을 넣어 주는데, zod 의 .optional() 은
  // undefined 만 허용하고 null 은 거부한다. .nullable() 이 빠져 있어서 요약 카드 문장이
  // 없는(= 초기에 만들어진) 캐릭터는 preview 파싱이 통째로 실패했고, 페이지가 notFound()
  // 로 빠져 리포트 링크가 404 가 됐다. 실제로 저장된 11개 중 9개가 이 상태였다.
  personalityTags: personalityTagStateSchema.nullable().optional(),
  // 요약 카드별 키워드 태그(스캔용). 키=요약 필드명, 값=짧은 키워드 배열.
  summaryTags: z.record(z.string(), z.array(z.string())).nullable().optional(),
  // 요약 카드 전용 한 문장(카드 미리보기용). 없으면 렌더에서 본문 첫 문장으로 폴백.
  summaryCardLines: summaryCardLinesSchema.nullable().optional(),
});

export type CharacterReportPreview = z.infer<typeof characterReportPreviewSchema>;

function compactFallback(text: string | undefined, max = 220) {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  const cut = normalized.slice(0, max).trimEnd();
  const sentenceEnd = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('요.'), cut.lastIndexOf('?'), cut.lastIndexOf('!'));
  return sentenceEnd > 70 ? cut.slice(0, sentenceEnd + 1) : `${cut}…`;
}

export function buildCharacterReportPreview(passport: CharacterPassport): CharacterReportPreview {
  const analysis = passport.analysis;
  const summary = analysis.summary ?? {
    outerSelf: compactFallback(analysis.outerSelf ?? analysis.characterOverview),
    innerSelf: compactFallback(analysis.innerSelf ?? analysis.innerMechanics),
    conflictStyle: compactFallback(analysis.conflictStyle ?? analysis.conflictStyleDetailed),
    affectionStyle: compactFallback(analysis.affectionStyle ?? analysis.attachmentStyle ?? analysis.relationshipStyle),
  };

  return characterReportPreviewSchema.parse({
    name: passport.basicProfile.name,
    shareCode: passport.shareCode,
    oneLineSummary: analysis.oneLineSummary,
    summary,
    personalityTags: passport.personalityTags,
    summaryTags: analysis.summaryTags,
    summaryCardLines: analysis.summaryCardLines,
  });
}
