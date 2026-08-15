import { z } from 'zod';

export const interviewQuestionSchema = z.object({
  order: z.number().int().min(1).max(20),
  category: z.enum(['core', 'relationship', 'conflict', 'inner', 'validation']),
  question: z.string().min(8),
  options: z.array(z.string().min(1)).min(3).max(5),
  allowCustom: z.boolean().default(true),
  rationale: z.string().min(1),
});

export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;
