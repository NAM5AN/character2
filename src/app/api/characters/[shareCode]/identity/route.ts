import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode,isShareCode } from '@/lib/share-code';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

// ownerName 없이 editToken만 보내면 현재 오너명을 읽어옵니다.
// 오너명은 더 이상 공개 preview에 실리지 않으므로, 오너 본인 화면은 이 경로로 값을 채웁니다.
const requestSchema=z.object({
  editToken:z.string().min(16),
  ownerName:z.string().trim().min(1).max(80).optional(),
});

export async function POST(request:Request,context:{params:Promise<{shareCode:string}>}){
  try{
    await assertRateLimit('character_owner_name_save',12,10);
    const {shareCode:raw}=await context.params;
    const shareCode=normalizeShareCode(raw);
    if(!isShareCode(shareCode))return NextResponse.json({error:'INVALID_SHARE_CODE'},{status:400});
    const body=requestSchema.parse(await request.json());
    const sb=getSupabaseServer();

    if(body.ownerName===undefined){
      const {data,error}=await sb.rpc('character2_get_owner_name',{p_share_code:shareCode,p_edit_token:body.editToken});
      if(error)throw error;
      return NextResponse.json({ok:true,ownerName:typeof data==='string'?data:''});
    }

    const ownerName=body.ownerName.replace(/\s+/g,' ').trim();
    const {data,error}=await sb.rpc('character2_set_owner_name',{p_share_code:shareCode,p_edit_token:body.editToken,p_owner_name:ownerName});
    if(error){
      // 같은 캐릭터명 + 같은 오너명 조합이 이미 있으면 RPC 가 예외를 던진다(오너명 변경 유도).
      if(typeof error.message==='string'&&error.message.includes('OWNER_NAME_DUPLICATE'))
        return NextResponse.json({error:'OWNER_NAME_DUPLICATE'},{status:409});
      throw error;
    }
    if(data!==true)return NextResponse.json({error:'EDIT_TOKEN_INVALID'},{status:403});
    return NextResponse.json({ok:true,ownerName});
  }catch(error){return apiError(error)}
}
