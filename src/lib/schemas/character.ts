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

export const summaryAnalysisRawSchema=z.object({oneLineSummary:z.unknown(),summary:z.record(z.string(),z.unknown()).optional().default({}),evidencePack:z.record(z.string(),z.unknown()).optional().default({})}).passthrough();
export const summaryAnalysisGenerationSchema=z.object({oneLineSummary:z.string().min(25).max(80),summary:analysisTypeSummarySchema,evidencePack:characterEvidencePackSchema});

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

export const finalAnalysisSchema=z.object({
  oneLineSummary:z.string(),
  summary:analysisTypeSummarySchema.optional(),

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
  relationshipManual:z.object({gettingClose:z.array(z.string()),avoid:z.array(z.string()),affectionSignals:z.array(z.string())}).optional(),
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
