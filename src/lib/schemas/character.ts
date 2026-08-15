import { z } from 'zod';

export const verdictSchema = z.enum(['confirmed', 'ambiguous', 'rejected', 'unreviewed']);

export const inferenceSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  confidence: z.number().min(0).max(100),
  ownerVerdict: verdictSchema.default('unreviewed'),
});

export const interviewAnswerSchema = z.object({
  order: z.number().int().min(1).max(20),
  question: z.string().min(1),
  answer: z.string().min(1),
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

export const initialCharacterDraftSchema = z.object({
  basicProfile: z.object({
    name: z.string().min(1),
    age: z.union([z.string(), z.number()]).nullable().optional(),
    gender: z.string().nullable().optional(),
  }),
  traits: z.record(z.string(), traitValueSchema),
  relationshipTraits: z.record(z.string(), traitValueSchema),
  confirmedFacts: z.array(z.object({
    key: z.string(),
    value: z.unknown(),
  })),
  aiInferences: z.array(inferenceSchema),
  analysisConfidence: z.number().min(0).max(100),
});

export const characterDraftSchema = z.object({
  basicProfile: z.object({
    name: z.string().min(1),
    age: z.union([z.string(), z.number()]).nullable().optional(),
    gender: z.string().nullable().optional(),
    profileText: z.string().min(20),
  }),
  traits: z.record(z.string(), traitValueSchema),
  relationshipTraits: z.record(z.string(), traitValueSchema),
  confirmedFacts: z.array(confirmedFactSchema),
  aiInferences: z.array(inferenceSchema),
  analysisConfidence: z.number().min(0).max(100),
});

export const finalAnalysisSchema = z.object({
  oneLineSummary: z.string(),
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
});

export const characterPassportSchema = z.object({
  schemaVersion: z.literal('character-passport/1.0'),
  characterId: z.string().uuid(),
  shareCode: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
  basicProfile: characterDraftSchema.shape.basicProfile,
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
