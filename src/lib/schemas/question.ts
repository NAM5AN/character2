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

export const questionResponseTypeSchema = z.enum([
  'fill_blank',
  'sentence_continue',
  'dialogue_choice',
  'bipolar_scale',
  'ranking',
  'forced_choice',
  'multi_select',
  'least_likely',
  'slider',
  'relationship_matrix',
  'inner_outer',
  'temporal_compare',
  'condition_followup',
  'in_character_response',
  'owner_meta',
]);

const matrixRowOptionsSchema = z.record(
  z.string().min(1).max(65),
  z.array(z.string().min(1).max(65)).min(2).max(5),
);

export const questionResponseConfigSchema = z.object({
  prompt2: z.string().min(1).max(160).optional(),
  leftLabel: z.string().min(1).max(65).optional(),
  rightLabel: z.string().min(1).max(65).optional(),
  minLabel: z.string().min(1).max(65).optional(),
  maxLabel: z.string().min(1).max(65).optional(),
  rows: z.array(z.string().min(1).max(65)).max(6).default([]),
  // Legacy/shared matrix options. New relationship_matrix questions should prefer rowOptions.
  columns: z.array(z.string().min(1).max(65)).max(5).default([]),
  // Per-row choices for relationship_matrix. Keys must match rows exactly.
  rowOptions: matrixRowOptionsSchema.default({}),
  // Separate option set for the changed-condition follow-up (condition_followup only).
  options2: z.array(z.string().min(1).max(65)).max(6).default([]),
  maxSelections: z.number().int().min(1).max(6).optional(),
}).default({ rows: [], columns: [], rowOptions: {}, options2: [] });

const OPTION_RESPONSE_TYPES = new Set([
  'fill_blank',
  'dialogue_choice',
  'ranking',
  'forced_choice',
  'multi_select',
  'least_likely',
  'temporal_compare',
  'condition_followup',
  'owner_meta',
]);

export const interviewQuestionSchema = z.object({
  order: z.number().int().min(1).max(20),
  category: questionCategorySchema,
  mode: questionModeSchema,
  format: questionFormatSchema,
  responseType: questionResponseTypeSchema,
  responseConfig: questionResponseConfigSchema,
  targetHook: z.string().min(2).max(90),
  hypothesis: z.string().min(2).max(180),
  question: z.string().min(8).max(120),
  options: z.array(z.string().min(1).max(65)).max(6).default([]),
  allowCustom: z.boolean().default(true),
  rationale: z.string().min(1).max(260),
}).superRefine((value, ctx) => {
  const type = value.responseType;
  const options = value.options;
  const config = value.responseConfig;

  if (OPTION_RESPONSE_TYPES.has(type) && type !== 'forced_choice' && options.length < 3) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '이 답변 형식은 최소 3개의 선택지가 필요합니다.' });
  }
  if (type === 'forced_choice' && options.length !== 2) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '양자택일은 정확히 2개의 선택지가 필요합니다.' });
  }
  if (type === 'ranking' && options.length > 5) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '순위형은 최대 5개의 항목만 사용합니다.' });
  }
  if (type === 'multi_select' && options.length < 4) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '복수선택형은 4개 이상의 선택지가 필요합니다.' });
  }
  if (!OPTION_RESPONSE_TYPES.has(type) && options.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '이 답변 형식에서는 options를 비워야 합니다.' });
  }
  if (type === 'bipolar_scale' && (!config.leftLabel || !config.rightLabel)) {
    ctx.addIssue({ code: 'custom', path: ['responseConfig'], message: '양극 척도형에는 leftLabel과 rightLabel이 필요합니다.' });
  }
  if (type === 'slider' && (!config.minLabel || !config.maxLabel)) {
    ctx.addIssue({ code: 'custom', path: ['responseConfig'], message: '슬라이더형에는 minLabel과 maxLabel이 필요합니다.' });
  }
  if (type === 'relationship_matrix') {
    if (config.rows.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['responseConfig', 'rows'], message: '관계별 반응표에는 2개 이상의 상대/조건이 필요합니다.' });
    }
    const rowOptionKeys = Object.keys(config.rowOptions || {});
    if (rowOptionKeys.length > 0) {
      for (const row of config.rows) {
        if (!config.rowOptions[row] || config.rowOptions[row].length < 2) {
          ctx.addIssue({ code: 'custom', path: ['responseConfig', 'rowOptions', row], message: `"${row}"에 맞는 선택지를 2개 이상 넣어야 합니다.` });
        }
      }
      for (const key of rowOptionKeys) {
        if (!config.rows.includes(key)) {
          ctx.addIssue({ code: 'custom', path: ['responseConfig', 'rowOptions', key], message: 'rowOptions의 키는 rows에 있는 상대/조건명과 같아야 합니다.' });
        }
      }
    } else if (config.columns.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['responseConfig', 'columns'], message: '구버전 관계별 반응표에는 공통 선택지가 2개 이상 필요합니다.' });
    }
  }
  if ((type === 'inner_outer' || type === 'condition_followup') && !config.prompt2) {
    ctx.addIssue({ code: 'custom', path: ['responseConfig', 'prompt2'], message: '두 번째 질문 문구가 필요합니다.' });
  }
  if (type === 'condition_followup' && (config.options2 || []).length < 3) {
    ctx.addIssue({ code: 'custom', path: ['responseConfig', 'options2'], message: '조건 변경형에는 바뀐 상황용 선택지(options2)가 3개 이상 필요합니다.' });
  }
  if (type === 'temporal_compare' && (!config.leftLabel || !config.rightLabel)) {
    ctx.addIssue({ code: 'custom', path: ['responseConfig'], message: '시간 비교형에는 두 시점 라벨이 필요합니다.' });
  }
});

export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;
export type QuestionCategory = z.infer<typeof questionCategorySchema>;
export type QuestionMode = z.infer<typeof questionModeSchema>;
export type QuestionFormat = z.infer<typeof questionFormatSchema>;
export type QuestionResponseType = z.infer<typeof questionResponseTypeSchema>;
