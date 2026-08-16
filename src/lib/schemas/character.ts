import { z } from 'zod';

export const verdictSchema = z.enum(['confirmed', 'ambiguous', 'rejected', 'unreviewed']);

export const inferenceSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  confidence: z.number().min(0).max(100),
  // New analyses ground each inference in server-generated profile fact IDs.
  // Defaults keep previously saved Character Passports readable.
  evidenceIds: z.array(z.string().regex(/^fact_\d{3,}$/)).max(4).default([]),
  evidence: z.array(z.string().min(1).max(260)).max(4).default([]),
  ownerVerdict: verdictSchema.default('unreviewed'),
  // Optional owner clarification/correction for ambiguous or rejected AI reads.
  ownerFeedback: z.string().max(1200).optional(),
});

export const interviewAnswerSchema = z.object({
  order: z.number().int().min(1).max(20),
  question: z.string().min(1),
  answer: z.string().min(1),
  reason: z.string().max(1200).optional(),
  branchContext: z.record(z.string(), z.unknown()).optional(),
});

const traitValueSchema = z.union([
  z.number().min(0).max(100),
  z.string(),
  z.boolean(),
  z.null(),
]);

const confirmedFactSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.enum(['profile', 'owner_answer']),
});

const publicBasicProfileSchema = z.object({
  name: z.string().min(1),
  age: z.union([z.string(), z.number()]).nullable().optional(),
  gender: z.string().nullable().optional(),
  profileText: z.string().min(20),
});

// AI parser output is intentionally loose. The server normalizes this into
// CharacterDraft instead of trusting model-chosen field names/types.
export const initialCharacterDraftSchema = z.object({
  basicProfile: z.record(z.string(), z.unknown()).optional().default({}),
  traits: z.record(z.string(), z.unknown()).optional().default({}),
  relationshipTraits: z.record(z.string(), z.unknown()).optional().default({}),
  confirmedFacts: z.array(z.unknown()).optional().default([]),
  aiInferences: z.array(z.unknown()).optional().default([]),
  analysisConfidence: z.unknown().optional(),
}).passthrough();

export const characterDraftSchema = z.object({
  basicProfile: publicBasicProfileSchema.extend({
    secretProfileText: z.string().max(50_000).optional(),
  }),
  traits: z.record(z.string(), traitValueSchema),
  relationshipTraits: z.record(z.string(), traitValueSchema),
  confirmedFacts: z.array(confirmedFactSchema),
  aiInferences: z.array(inferenceSchema),
  analysisConfidence: z.number().min(0).max(100),
});

export const analysisTypeSummarySchema = z.object({
  outerSelf: z.string().min(70).max(160),
  innerSelf: z.string().min(70).max(160),
  conflictStyle: z.string().min(70).max(160),
  affectionStyle: z.string().min(70).max(160),
});

const reportListSchema = z.array(z.string().min(8).max(80)).min(2).max(5);

// Loose transport schema. AI providers occasionally emit paragraph fields as
// string arrays; the server normalizes these before strict length validation.
export const finalAnalysisRawSchema = z.object({
  oneLineSummary: z.unknown(),
  summary: z.record(z.string(), z.unknown()).optional().default({}),
  outerSelf: z.unknown(),
  innerSelf: z.unknown(),
  coreValues: z.unknown(),
  desires: z.unknown(),
  fears: z.unknown(),
  conflictStyle: z.unknown(),
  affectionStyle: z.unknown(),
  misunderstoodPoints: z.unknown(),
  contradictions: z.unknown(),
  interestingPoints: z.unknown(),
  detailedReport: z.unknown(),
}).passthrough();

// Strict schema used after server normalization for new AI generation.
export const finalAnalysisGenerationSchema = z.object({
  oneLineSummary: z.string().min(25).max(80),
  summary: analysisTypeSummarySchema,
  outerSelf: z.string().min(180).max(360),
  innerSelf: z.string().min(180).max(360),
  coreValues: reportListSchema,
  desires: reportListSchema,
  fears: reportListSchema,
  conflictStyle: z.string().min(180).max(360),
  affectionStyle: z.string().min(180).max(360),
  misunderstoodPoints: reportListSchema,
  contradictions: reportListSchema,
  interestingPoints: reportListSchema,
  detailedReport: z.string().min(700).max(1400),
});

// Compatibility schema for stored passports. New layered fields are optional so
// previously issued 8-character share codes remain readable.
export const finalAnalysisSchema = z.object({
  oneLineSummary: z.string(),
  summary: analysisTypeSummarySchema.optional(),
  outerSelf: z.string(),
  innerSelf: z.string(),
  coreValues: z.array(z.string()),
  desires: z.array(z.string()),
  fears: z.array(z.string()),
  conflictStyle: z.string(),
  affectionStyle: z.string(),
  misunderstoodPoints: z.array(z.string()),
  contradictions: z.array(z.string()),
  interestingPoints: z.array(z.string()),
  detailedReport: z.string().optional(),
});

export const characterPassportSchema = z.object({
  schemaVersion: z.literal('character-passport/1.0'),
  characterId: z.string().uuid(),
  shareCode: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
  basicProfile: publicBasicProfileSchema,
  traits: characterDraftSchema.shape.traits,
  relationshipTraits: characterDraftSchema.shape.relationshipTraits,
  confirmedFacts: characterDraftSchema.shape.confirmedFacts,
  aiInferences: characterDraftSchema.shape.aiInferences,
  interview: z.object({
    version: z.literal('interview/1.0'),
    completedCount: z.number().int().min(0).max(20),
    answers: z.array(interviewAnswerSchema),
  }),
  analysis: finalAnalysisSchema,
  engineVersions: z.object({
    parser: z.string(),
    interview: z.string(),
    analysis: z.string(),
  }),
});

export type InitialCharacterDraft = z.infer<typeof initialCharacterDraftSchema>;
export type CharacterDraft = z.infer<typeof characterDraftSchema>;
export type InterviewAnswer = z.infer<typeof interviewAnswerSchema>;
export type CharacterPassport = z.infer<typeof characterPassportSchema>;
export type FinalAnalysis = z.infer<typeof finalAnalysisSchema>;
export type FinalAnalysisGeneration = z.infer<typeof finalAnalysisGenerationSchema>;
export type AnalysisTypeSummary = z.infer<typeof analysisTypeSummarySchema>;
