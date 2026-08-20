import { NextResponse } from 'next/server';
import { readJsonWithinBudget } from '@/lib/request-budget';
import { z } from 'zod';
import { characterDraftSchema } from '@/lib/schemas/character';
import { interviewQuestionSchema } from '@/lib/schemas/question';
import { askOpenAIJson } from '@/lib/ai/openai';
import { withAiUsageContext } from '@/lib/ai/usage';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema=z.object({draft:characterDraftSchema,question:interviewQuestionSchema});

function responseSchema(firstOptions:string[]){
  return z.object({options2:z.array(z.string().min(1).max(65)).length(4)}).superRefine((value,ctx)=>{
    const choices=value.options2.map(item=>item.trim());
    if(new Set(choices).size!==4)ctx.addIssue({code:'custom',path:['options2'],message:'두 번째 시점 선택지는 서로 다른 4개여야 합니다.'});
    if(choices.some(choice=>/직접\s*입력|기타/u.test(choice)))ctx.addIssue({code:'custom',path:['options2'],message:'직접 입력/기타는 넣지 마세요.'});
    const first=firstOptions.map(item=>item.trim()).slice().sort().join('\u0001');
    const second=choices.slice().sort().join('\u0001');
    if(first===second)ctx.addIssue({code:'custom',path:['options2'],message:'첫 시점과 완전히 같은 보기 세트를 복사하지 마세요.'});
  });
}

export async function POST(request:Request){
  try{
    await assertRateLimit('temporal_option_repair',30,60);
    const body=requestSchema.parse(await readJsonWithinBudget(request));
    if(body.question.responseType!=='temporal_compare')return NextResponse.json({error:'NOT_TEMPORAL_COMPARE'},{status:400});
    const firstOptions=body.question.options.slice(0,4);
    const config=body.question.responseConfig;
    const result=await withAiUsageContext({sessionId:body.draft.usageSessionId,stage:`temporal_options_${body.question.order}`},()=>askOpenAIJson({
      instructions:`자캐커뮤니티 인터뷰의 시간 비교형 문항에서 두 번째 시점 선택지만 다시 만드는 작업입니다. JSON은 options2만 출력하세요.\n- 정확히 4개를 만드세요.\n- 첫 시점의 선택지를 그대로 복사하지 마세요.\n- 두 번째 시점에는 시간이 흐르면서 새로 알게 된 사실, 관계 변화, 이미 끝난 행동을 반영하세요.\n- 두 번째 시점에서 이미 지나간 일을 처음 알게 된 것처럼 행동하는 보기는 금지합니다.\n- 네 선택지는 서로 다른 실제 행동·말·판단이어야 합니다.\n- 직접 입력/기타는 넣지 마세요.\n- 어느 답이 더 도덕적으로 좋아 보이지 않게 구성하세요.`,
      schema:responseSchema(firstOptions),
      maxOutputTokens:700,
      input:`캐릭터: ${body.draft.basicProfile.name}\n질문: ${body.question.question}\n첫 시점: ${config.leftLabel||'직후'}\n두 번째 시점: ${config.rightLabel||'시간이 지난 뒤'}\n첫 시점 보기: ${JSON.stringify(firstOptions)}\n캐릭터 성향 참고: ${JSON.stringify({traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits,personalityTags:body.draft.personalityTags})}`,
    }));
    return NextResponse.json({options2:result.options2});
  }catch(error){return apiError(error)}
}
