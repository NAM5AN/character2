import { z } from 'zod';
import type { CharacterPassport } from '@/lib/schemas/character';

export const characterReportPreviewSchema = z.object({
  name: z.string().min(1),
  shareCode: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
  oneLineSummary: z.string(),
  summary: z.object({
    outerSelf: z.string(),
    innerSelf: z.string(),
    conflictStyle: z.string(),
    affectionStyle: z.string(),
  }),
});

export type CharacterReportPreview = z.infer<typeof characterReportPreviewSchema>;

function compactFallback(text: string | undefined, max = 160) {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  const cut = normalized.slice(0, max - 1).trimEnd();
  const sentenceEnd = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('다.'), cut.lastIndexOf('요.'));
  return `${sentenceEnd > 65 ? cut.slice(0, sentenceEnd + 1) : cut}…`;
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
  });
}
