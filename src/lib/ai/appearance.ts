import 'server-only';
import { z } from 'zod';
import { generateValidatedJson } from '@/lib/ai/json';

export type AppearanceImageInput = {
  name: string;
  dataUrl: string;
};

const appearanceAnalysisSchema = z.object({
  summary: z.string(),
  observableDetails: z.array(z.string()).default([]),
  stylingAndMotifs: z.array(z.string()).default([]),
  hairColor: z.string().optional(),
  eyeColor: z.string().optional(),
  visualImpression: z.string(),
  uncertainties: z.array(z.string()).default([]),
});

const APPEARANCE_SYSTEM = `당신은 자캐커뮤니티의 캐릭터 외관 자료를 읽는 시각 자료 분석가입니다.
첨부 이미지는 실존 인물 식별용이 아니라 캐릭터의 외형·의상·소품·표현 방식을 파악하기 위한 참고 자료입니다.

반드시 지킬 것:
- 이미지에서 실제로 보이는 특징만 관찰하세요. 보이지 않는 설정을 만들지 마세요.
- 외모만으로 성격, 정신상태, 과거, 도덕성, 관계 성향을 확정하지 마세요.
- 인종·민족·국적·성적 지향·질병·장애 같은 민감한 속성을 외형만 보고 추정하지 마세요.
- 그림체, 조명, 카메라 연출만으로 캐릭터의 공식 성격이라고 단정하지 마세요.
- 여러 장이면 반복해서 일치하는 특징과 한 장에만 나타나는 연출을 구분하세요.
- 텍스트가 작거나 흐리면 읽었다고 가정하지 마세요.
- 머리색과 눈동자색은 조명·배경·필터색이 아니라 캐릭터 자체의 고유색을 우선하세요. 확실하지 않으면 생략하세요.

출력 목적:
- summary: 전체 외형을 짧게 통합한 관찰
- observableDetails: 헤어, 눈매/표정, 체형·자세, 의상, 색감, 소품 등 직접 관찰 가능한 핵심 특징
- stylingAndMotifs: 반복되는 장식, 색, 소재, 소품, 실루엣 등 시각적 모티프
- hairColor: 머리색이 식별되면 가장 가까운 한국어 색명과 대표 HEX(#RRGGBB)를 함께 작성. 예: "검은색 #202124". 불확실하면 생략
- eyeColor: 눈동자색이 식별되면 가장 가까운 한국어 색명과 대표 HEX(#RRGGBB)를 함께 작성. 예: "푸른색 #4E75A4". 불확실하면 생략
- visualImpression: 타인이 처음 봤을 때 받을 수 있는 '시각적 인상'만 설명. 내면 성격 단정 금지
- uncertainties: 자료마다 다르거나 연출 가능성이 높아 확정하기 어려운 점`;

export async function analyzeAppearanceImages(images: AppearanceImageInput[]) {
  if (!images.length) return '';
  const result = await generateValidatedJson({
    model: process.env.APPEARANCE_MODEL || 'anthropic/claude-sonnet-5',
    system: APPEARANCE_SYSTEM,
    schema: appearanceAnalysisSchema,
    maxOutputTokens: 1800,
    maxAttempts: 2,
    images: images.map(image => image.dataUrl),
    prompt: `첨부 외관 자료 ${images.length}장을 순서대로 읽어주세요.\n이미지 순서와 파일명: ${images.map((image,index)=>`${index+1}. ${image.name}`).join(' / ')}\n\n이 결과는 이후 캐릭터 분석에서 보조 근거로 쓰입니다. 외관 관찰 자체와 심리 추론을 섞지 마세요.`,
  });

  const lines = [
    '외관 자료 관찰 메모 — 아래 내용은 시각 자료에서 직접 관찰한 보조 정보이며, 성격·감정·과거를 단독으로 확정하는 근거가 아닙니다.',
    `전체 외형: ${result.summary}`,
    ...(result.hairColor?.trim() ? [`머리색 관찰: ${result.hairColor.trim()}`] : []),
    ...(result.eyeColor?.trim() ? [`눈동자색 관찰: ${result.eyeColor.trim()}`] : []),
    ...(result.observableDetails ?? []).slice(0,12).map(item=>`관찰 특징: ${item}`),
    ...(result.stylingAndMotifs ?? []).slice(0,8).map(item=>`시각 모티프: ${item}`),
    `첫 시각 인상: ${result.visualImpression}`,
    ...(result.uncertainties ?? []).slice(0,5).map(item=>`확정 주의: ${item}`),
  ];
  return lines.filter(Boolean).join('\n').slice(0,8000);
}
