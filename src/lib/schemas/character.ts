import { z } from 'zod';

export const verdictSchema = z.enum(['confirmed', 'ambiguous', 'rejected', 'unreviewed']);

export const inferenceSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  confidence: z.number().min(0).max(100),
  evidenceIds: z.array(z.string().regex(/^fact_\d{3,}$/)).max(4).default([]),
  evidence: z.array(z.string().min(1).max(260)).max(4).default([]),
  ownerVerdict: verdictSchema.default('unreviewed'),
  ownerFeedback: z.string().max(1200).optional(),
});

export const interviewAnswerSchema = z.object({
  order: z.number().int().min(1).max(20),
  question: z.string().min(1),
  answer: z.string().min(1),
  reason: z.string().max(1200).optional(),
  branchContext: z.record(z.string(), z.unknown()).optional(),
});

const traitValueSchema = z.union([z.number().min(0).max(100),z.string(),z.boolean(),z.null()]);
const confirmedFactSchema = z.object({key:z.string(),value:z.unknown(),source:z.enum(['profile','owner_answer'])});
const publicBasicProfileSchema = z.object({name:z.string().min(1),age:z.union([z.string(),z.number()]).nullable().optional(),gender:z.string().nullable().optional(),profileText:z.string().min(20)});

export const initialCharacterDraftSchema=z.object({basicProfile:z.record(z.string(),z.unknown()).optional().default({}),traits:z.record(z.string(),z.unknown()).optional().default({}),relationshipTraits:z.record(z.string(),z.unknown()).optional().default({}),confirmedFacts:z.array(z.unknown()).optional().default([]),aiInferences:z.array(z.unknown()).optional().default([]),analysisConfidence:z.unknown().optional()}).passthrough();
export const characterDraftSchema=z.object({usageSessionId:z.string().uuid().optional(),basicProfile:publicBasicProfileSchema.extend({secretProfileText:z.string().max(50_000).optional(),appearanceNotes:z.string().max(8_000).optional()}),traits:z.record(z.string(),traitValueSchema),relationshipTraits:z.record(z.string(),traitValueSchema),confirmedFacts:z.array(confirmedFactSchema),aiInferences:z.array(inferenceSchema),analysisConfidence:z.number().min(0).max(100)});

// Public summary: legacy four fields stay required for old passports and compatibility.
// New teaser-only fields are optional so previously saved characters remain readable.
// Generation is instructed to stay around 160~240 chars, but allow headroom so a good
// two-paragraph answer is not discarded merely because the model runs slightly long.
export const analysisTypeSummarySchema=z.object({
  outerSelf:z.string().min(20).max(800),
  innerSelf:z.string().min(20).max(800),
  conflictStyle:z.string().min(20).max(800),
  affectionStyle:z.string().min(20).max(800),
  misunderstoodPoint:z.string().min(20).max(800).optional(),
  hiddenPattern:z.string().min(20).max(800).optional(),
});

// 요약 카드 전용 한 문장(카드 미리보기). 긴 summary 본문을 자르지 않고 AI가 별도로 생성한 결론형 한 문장.
// 모두 optional(구버전 저장본은 없으므로 폴백 사용). 카드 6개 키는 summary 필드명과 동일.
export const summaryCardLinesSchema=z.object({
  outerSelf:z.string().min(6).max(90),
  innerSelf:z.string().min(6).max(90),
  conflictStyle:z.string().min(6).max(90),
  affectionStyle:z.string().min(6).max(90),
  misunderstoodPoint:z.string().min(6).max(90),
  hiddenPattern:z.string().min(6).max(90),
}).partial();

// 스캔용 키워드 태그. 키=섹션/카드 필드명, 값=짧은 키워드 2~3개. 모두 optional(예전 저장본 호환).
export const keywordTagMapSchema=z.record(z.string(),z.array(z.string().min(1).max(16)).max(4));
// 상세 섹션 태그는 섹션별 "평면 키"로 저장한다(스테이지 병합 시 nested 맵이 서로를 덮는 충돌을 피함).
export const tagListSchema=z.array(z.string().min(1).max(16)).max(4);
// 섹션 핵심 한 줄 요약(TL;DR).
export const tldrLineSchema=z.string().min(1).max(140);
// 성향 스펙트럼 바 — 두 극(left↔right) 사이 캐릭터의 위치(value 0=left, 100=right). 섹션별 평면 키로 저장(병합 안전).
export const spectrumItemSchema=z.object({left:z.string().min(1).max(24),right:z.string().min(1).max(24),value:z.number().min(0).max(100)});
export const spectrumListSchema=z.array(spectrumItemSchema).max(4);

const evidenceTextSchema=z.string().min(8).max(190);
const interviewEvidenceSchema=z.object({order:z.number().int().min(1).max(20),finding:z.string().min(8).max(190)});

export const characterEvidencePackSchema=z.object({
  version:z.literal('evidence-pack/2.0'),
  publicProfileEvidence:z.array(evidenceTextSchema).max(32).default([]),
  secretProfileEvidence:z.array(evidenceTextSchema).max(28).default([]),
  ownerReviewEvidence:z.array(evidenceTextSchema).max(20).default([]),
  interviewEvidence:z.array(interviewEvidenceSchema).length(20),
  behaviorRules:z.array(evidenceTextSchema).max(14).default([]),
  relationshipPatterns:z.array(evidenceTextSchema).max(12).default([]),
  emotionalPatterns:z.array(evidenceTextSchema).max(12).default([]),
  valuesAndMotives:z.array(evidenceTextSchema).max(12).default([]),
  exceptionsAndConditions:z.array(evidenceTextSchema).max(12).default([]),
  tensionsAndContradictions:z.array(evidenceTextSchema).max(10).default([]),
  distinctiveDetails:z.array(evidenceTextSchema).max(16).default([]),
  uncertainties:z.array(evidenceTextSchema).max(10).default([]),
});

const summaryAnalysisRawSummarySchema=z.object({
  outerSelf:z.unknown(),
  innerSelf:z.unknown(),
  conflictStyle:z.unknown(),
  affectionStyle:z.unknown(),
  misunderstoodPoint:z.unknown(),
  hiddenPattern:z.unknown(),
});
export const summaryAnalysisRawSchema=z.object({oneLineSummary:z.unknown(),summary:summaryAnalysisRawSummarySchema,evidencePack:z.record(z.string(),z.unknown()).optional().default({})}).passthrough();
export const summaryAnalysisGenerationSchema=z.object({oneLineSummary:z.string().min(25).max(80),summary:analysisTypeSummarySchema,summaryTags:keywordTagMapSchema.optional(),summaryCardLines:summaryCardLinesSchema.optional(),evidencePack:characterEvidencePackSchema});

// Paid detail 6.4+: seven large narrative sections only.
// No character-count limits are applied to these generated sections.
export const detailAnalysisRawSchema=z.object({
  characterOverview:z.unknown(),
  innerMechanics:z.unknown(),
  relationshipStyle:z.unknown(),
  attachmentStyle:z.unknown(),
  conflictStyleDetailed:z.unknown(),
  charmAndContradictions:z.unknown(),
  integratedReport:z.unknown(),
}).passthrough();

export const detailAnalysisGenerationSchema=z.object({
  characterOverview:z.string(),
  innerMechanics:z.string(),
  relationshipStyle:z.string(),
  attachmentStyle:z.string(),
  conflictStyleDetailed:z.string(),
  charmAndContradictions:z.string(),
  integratedReport:z.string(),
});

export const finalAnalysisRawSchema=z.object({
  oneLineSummary:z.unknown(),summary:z.record(z.string(),z.unknown()).optional().default({}),
  characterOverview:z.unknown(),innerMechanics:z.unknown(),relationshipStyle:z.unknown(),attachmentStyle:z.unknown(),conflictStyleDetailed:z.unknown(),charmAndContradictions:z.unknown(),integratedReport:z.unknown(),
}).passthrough();
export const finalAnalysisGenerationSchema=z.object({oneLineSummary:z.string().min(25).max(80),summary:analysisTypeSummarySchema,...detailAnalysisGenerationSchema.shape});

// ── 혼합 레이아웃용 구조화 블록 ──
// 산문 섹션 사이에 끼우는 나열·비교·단계 블록. 모두 생성 optional(모델이 안 주면 산문만 렌더).
// 항목은 짧은 명사구/한 문장. 근거 없는 창작 금지는 프롬프트에서 통제한다.
const blockLine=z.string().min(1).max(90);
// 원하는 것 vs 정말 필요한 것 (2단 비교)
export const desireGapSchema=z.object({
  wants:z.array(blockLine).min(1).max(5),
  needs:z.array(blockLine).min(1).max(5),
});
// 잘 맞는 상대 / 최악의 상대 (2단 비교)
export const matchProfileSchema=z.object({
  best:z.array(blockLine).min(1).max(5),
  worst:z.array(blockLine).min(1).max(5),
});
// 캐릭터 사용설명서 (3칸 불렛)
export const relationshipManualSchema=z.object({
  gettingClose:z.array(blockLine).min(1).max(5),
  avoid:z.array(blockLine).min(1).max(5),
  affectionSignals:z.array(blockLine).min(1).max(5),
});
// 평상시 → 압박 → 한계 (3단계 진행)
export const pressureStagesSchema=z.object({
  normal:z.string().min(1).max(220),
  pressured:z.string().min(1).max(220),
  limit:z.string().min(1).max(220),
});

export const finalAnalysisSchema=z.object({
  oneLineSummary:z.string(),
  summary:analysisTypeSummarySchema.optional(),
  // 상세 리포트 섹션별 키워드 태그(구버전 nested 맵 — 백필/하위호환용, 렌더 폴백).
  sectionTags:keywordTagMapSchema.optional(),
  // 상세 섹션 태그 평면 키(신규 생성 경로 — 스테이지 병합 안전). 렌더는 이걸 우선 사용.
  characterOverviewTags:tagListSchema.optional(),
  innerMechanicsTags:tagListSchema.optional(),
  relationshipStyleTags:tagListSchema.optional(),
  attachmentStyleTags:tagListSchema.optional(),
  conflictStyleDetailedTags:tagListSchema.optional(),
  charmAndContradictionsTags:tagListSchema.optional(),
  integratedReportTags:tagListSchema.optional(),
  // 섹션 핵심 한 줄 요약(TL;DR). 제목·태그 아래 결론을 먼저 보여준다. 섹션별 평면 키(병합 안전).
  characterOverviewTldr:tldrLineSchema.optional(),
  innerMechanicsTldr:tldrLineSchema.optional(),
  relationshipStyleTldr:tldrLineSchema.optional(),
  attachmentStyleTldr:tldrLineSchema.optional(),
  conflictStyleDetailedTldr:tldrLineSchema.optional(),
  charmAndContradictionsTldr:tldrLineSchema.optional(),
  integratedReportTldr:tldrLineSchema.optional(),
  // 섹션 성향 스펙트럼(선별). 섹션별 평면 키.
  characterOverviewSpectrums:spectrumListSchema.optional(),
  innerMechanicsSpectrums:spectrumListSchema.optional(),
  relationshipStyleSpectrums:spectrumListSchema.optional(),
  attachmentStyleSpectrums:spectrumListSchema.optional(),
  conflictStyleDetailedSpectrums:spectrumListSchema.optional(),
  charmAndContradictionsSpectrums:spectrumListSchema.optional(),
  integratedReportSpectrums:spectrumListSchema.optional(),
  // 요약 카드별 키워드 태그(outerSelf 등 요약 필드 키).
  summaryTags:keywordTagMapSchema.optional(),
  // 요약 카드 전용 한 문장(카드 미리보기용).
  summaryCardLines:summaryCardLinesSchema.optional(),

  // 6.4+ grouped detail fields.
  characterOverview:z.string().optional(),
  innerMechanics:z.string().optional(),
  relationshipStyle:z.string().optional(),
  attachmentStyle:z.string().optional(),
  conflictStyleDetailed:z.string().optional(),
  charmAndContradictions:z.string().optional(),
  integratedReport:z.string().optional(),

  // Legacy detail fields are kept optional so already-saved reports remain readable.
  outerSelf:z.string().optional(),innerSelf:z.string().optional(),coreValues:z.array(z.string()).optional(),desires:z.array(z.string()).optional(),fears:z.array(z.string()).optional(),conflictStyle:z.string().optional(),affectionStyle:z.string().optional(),misunderstoodPoints:z.array(z.string()).optional(),contradictions:z.array(z.string()).optional(),interestingPoints:z.array(z.string()).optional(),detailedReport:z.string().optional(),
  corePersonality:z.string().optional(),developmentalRoots:z.string().optional(),emotionalStructure:z.string().optional(),defenseAndStress:z.string().optional(),relationshipPattern:z.string().optional(),attachmentPattern:z.string().optional(),romanceStyle:z.string().optional(),attractionCriteria:z.string().optional(),moralAndExtremeChoices:z.string().optional(),selfDeception:z.string().optional(),wantsVsNeeds:z.string().optional(),statedVsEnacted:z.string().optional(),strengthsAndRisks:z.array(z.string()).optional(),charmPoints:z.array(z.string()).optional(),hiddenTraits:z.array(z.string()).optional(),
  relationshipManual:relationshipManualSchema.optional(),
  // 6.8+ 혼합 레이아웃 구조화 블록(모두 optional).
  desireGap:desireGapSchema.optional(),
  matchProfile:matchProfileSchema.optional(),
  pressureStages:pressureStagesSchema.optional(),
});

export const characterPassportSchema=z.object({schemaVersion:z.literal('character-passport/1.0'),characterId:z.string().uuid(),shareCode:z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),basicProfile:publicBasicProfileSchema,traits:characterDraftSchema.shape.traits,relationshipTraits:characterDraftSchema.shape.relationshipTraits,confirmedFacts:characterDraftSchema.shape.confirmedFacts,aiInferences:characterDraftSchema.shape.aiInferences,interview:z.object({version:z.literal('interview/1.0'),completedCount:z.number().int().min(0).max(20),answers:z.array(interviewAnswerSchema)}),analysis:finalAnalysisSchema,engineVersions:z.object({parser:z.string(),interview:z.string(),analysis:z.string()})});

export type InitialCharacterDraft=z.infer<typeof initialCharacterDraftSchema>;
export type CharacterDraft=z.infer<typeof characterDraftSchema>;
export type InterviewAnswer=z.infer<typeof interviewAnswerSchema>;
export type CharacterPassport=z.infer<typeof characterPassportSchema>;
export type FinalAnalysis=z.infer<typeof finalAnalysisSchema>;
export type FinalAnalysisGeneration=z.infer<typeof finalAnalysisGenerationSchema>;
export type SummaryAnalysisGeneration=z.infer<typeof summaryAnalysisGenerationSchema>;
export type DetailAnalysisGeneration=z.infer<typeof detailAnalysisGenerationSchema>;
export type CharacterEvidencePack=z.infer<typeof characterEvidencePackSchema>;
export type AnalysisTypeSummary=z.infer<typeof analysisTypeSummarySchema>;
