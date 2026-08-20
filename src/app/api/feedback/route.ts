import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const attachmentSchema=z.object({
  path:z.string().min(1).max(500),
  name:z.string().min(1).max(240),
  type:z.string().regex(/^(image|video)\//i),
  size:z.number().int().min(0).max(30*1024*1024),
});

const schema=z.object({
  id:z.string().uuid(),
  category:z.enum(['bug','error','improvement']),
  content:z.string().trim().min(5).max(5000),
  environment:z.record(z.string(),z.unknown()).default({}),
  attachments:z.array(attachmentSchema).max(4).default([]),
});

export async function POST(request:Request){
  try{
    await assertRateLimit('feedback_submit',5,60);
    const body=schema.parse(await request.json());
    const sb=getSupabaseServer();
    const {data,error}=await sb.rpc('character2_submit_feedback',{
      p_id:body.id,
      p_category:body.category,
      p_content:body.content,
      p_environment:body.environment,
      p_attachments:body.attachments,
    });
    if(error)throw error;
    if(data!==true)return NextResponse.json({error:'FEEDBACK_SAVE_FAILED'},{status:400});
    return NextResponse.json({ok:true,id:body.id});
  }catch(error){return apiError(error)}
}
