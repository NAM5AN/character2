import type { CharacterPassport } from '@/lib/schemas/character';

export type CharacterReportPreview = {
  name: string;
  shareCode: string;
  oneLineSummary: string;
  summary: {
    outerSelf: string;
    innerSelf: string;
    conflictStyle: string;
    affectionStyle: string;
  };
};

function compactFallback(text: string, max = 160) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  const cut = normalized.slice(0, max - 1).trimEnd();
  const sentenceEnd = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('다.'), cut.lastIndexOf('요.'));
  return `${sentenceEnd > 65 ? cut.slice(0, sentenceEnd + 1) : cut}…`;
}

export function buildCharacterReportPreview(passport: CharacterPassport): CharacterReportPreview {
  const analysis = passport.analysis;
  const summary = analysis.summary ?? {
    outerSelf: compactFallback(analysis.outerSelf),
    innerSelf: compactFallback(analysis.innerSelf),
    conflictStyle: compactFallback(analysis.conflictStyle),
    affectionStyle: compactFallback(analysis.affectionStyle),
  };

  return {
    name: passport.basicProfile.name,
    shareCode: passport.shareCode,
    oneLineSummary: analysis.oneLineSummary,
    summary,
  };
}
