import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CHARACTER_DEEP_ANALYSIS_SKILL_VERSION = 'character-deep-analysis/1.1.1' as const;

type CharacterDeepAnalysisSkill = {
  core: string;
  analysisGuide: string;
  reportGuide: string;
  qualityExamples: string;
};

let cachedSkill: CharacterDeepAnalysisSkill | null = null;

const SKILL_ROOT = join(process.cwd(), 'skills', 'character-deep-analysis');

function readSkillFile(relativePath: string) {
  try {
    return readFileSync(join(SKILL_ROOT, relativePath), 'utf8').trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`CHARACTER_DEEP_ANALYSIS_SKILL_MISSING: ${relativePath}: ${message}`);
  }
}

export function getCharacterDeepAnalysisSkill(): CharacterDeepAnalysisSkill {
  if (cachedSkill) return cachedSkill;

  const core = readSkillFile('SKILL.md');
  const thematic = readSkillFile('references/thematic-coding.md');
  const latent = readSkillFile('references/latent-analysis.md');
  const contradiction = readSkillFile('references/contradiction-rules.md');
  const inference = readSkillFile('references/inference-rubric.md');
  const reportStyle = readSkillFile('references/report-style.md');
  const goodCases = readSkillFile('evals/good-cases.json');
  const failureCases = readSkillFile('evals/failure-cases.json');

  cachedSkill = {
    core,
    analysisGuide: [
      '# Character Deep Analysis — runtime skill',
      '아래 SKILL.md와 references가 이 호출의 분석 규칙입니다. 로컬 task prompt와 충돌하면 이 스킬의 핵심 원칙과 추론 품질 기준을 우선하세요.',
      core,
      thematic,
      latent,
      contradiction,
      inference,
    ].join('\n\n---\n\n'),
    reportGuide: [
      '# Character Deep Analysis — report writer skill',
      '아래 SKILL.md와 references가 최종 리포트의 해석 깊이와 문체 기준입니다. 단순 재서술·성격 라벨·뜬구름 추상을 실패로 취급하세요.',
      core,
      inference,
      reportStyle,
    ].join('\n\n---\n\n'),
    qualityExamples: [
      '# EVAL — 좋은 분석 예시',
      goodCases,
      '# EVAL — 반드시 피할 실패 예시',
      failureCases,
    ].join('\n\n'),
  };

  return cachedSkill;
}
