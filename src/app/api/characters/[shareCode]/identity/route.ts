import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode,isShareCode } from '@/lib/share-code';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema=z.object({
  editToken:z.string().min(16),
  ownerName:z.string().trim().min(1).max(80),
});

export async function POST(request:Request,context:{params:Promise<{shareCode:string}>}){
  try{
    await assertRateLimit('character_owner_name_save',12,10);
    const {shareCode:raw}=await context.params;
    const shareCode=normalizeShareCode(raw);
    if(!isShareCode(shareCode))return NextResponse.json({error:'INVALID_SHARE_CODE'},{status:400});
    const body=requestSchema.parse(await request.json());
    const ownerName=body.ownerName.replace(/\s+/g,' ').trim();
    const sb=getSupabaseServer();
    const {data,error}=await sb.rpc('character2_set_owner_name',{p_share_code:shareCode,p_edit_token:body.editToken,p_owner_name:ownerName});
    if(error)throw error;
    if(data!==true)return NextResponse.json({error:'EDIT_TOKEN_INVALID'},{status:403});
    return NextResponse.json({ok:true,ownerName});
  }catch(error){return apiError(error)}
}
