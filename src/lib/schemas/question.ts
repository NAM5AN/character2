import { z } from 'zod';

export const questionCategorySchema = z.enum(['core', 'relationship', 'conflict', 'inner', 'validation']);
export const questionModeSchema = z.enum(['branch', 'pivot', 'counter']);
export const questionFormatSchema = z.enum([
  'scenario',
  'comparison',
  'priority',
  'exception',
  'hypothesis',
  'relationship_contrast',
  'sentence_completion',
  'free_response',
]);

export const interviewQuestionSchema = z.object({
  order: z.number().int().min(1).max(20),
  category: questionCategorySchema,
  mode: questionModeSchema,
  format: questionFormatSchema,
  targetHook: z.string().min(2).max(90),
  hypothesis: z.string().min(2).max(180),
  question: z.string().min(8).max(110),
  options: z.array(z.string().min(1).max(75)).max(5).default([]),
  allowCustom: z.boolean().default(true),
  rationale: z.string().min(1).max(260),
}).superRefine((value, ctx) => {
  if (value.format !== 'free_response' && value.options.length < 3) {
    ctx.addIssue({
      code: 'custom',
      path: ['options'],
      message: '선택형 질문은 3~5개의 선택지가 필요합니다.',
    });
  }
  if (value.format === 'free_response' && value.options.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['options'],
      message: '자유서술형 질문은 선택지를 비워야 합니다.',
    });
  }
});

export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;
export type QuestionCategory = z.infer<typeof questionCategorySchema>;
export type QuestionMode = z.infer<typeof questionModeSchema>;
export type QuestionFormat = z.infer<typeof questionFormatSchema>;
