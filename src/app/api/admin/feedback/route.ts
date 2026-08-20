import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { readAdminToken } from '@/lib/admin-session';
import { apiError } from '@/lib/http';

const updateSchema=z.object({id:z.string().uuid(),status:z.enum(['new','read','resolved'])});
const SIGNED_URL_TTL_SECONDS=10*60;

export async function GET(){
  try{
    const token=await readAdminToken();
    if(!token)return NextResponse.json({error:'ADMIN_AUTH_INVALID'},{status:401});
    const sb=getSupabaseServer();
    const {data,error}=await sb.rpc('character2_admin_feedback_list',{p_token:token});
    if(error){if(error.message?.includes('ADMIN_AUTH_INVALID'))return NextResponse.json({error:'ADMIN_AUTH_INVALID'},{status:401});throw error}

    const reports=await Promise.all((Array.isArray(data)?data:[]).map(async(report:any)=>({
      ...report,
      attachments:Array.isArray(report.attachments)?await Promise.all(report.attachments.map(async(item:any)=>{
        if(typeof item?.path!=='string'||!item.path)return {...item,url:''};
        const {data:signed,error:signError}=await sb.storage.from('character2-feedback').createSignedUrl(item.path,SIGNED_URL_TTL_SECONDS);
        return {...item,url:signError?'':signed?.signedUrl||''};
      })):[],
    })));
    return NextResponse.json({reports,signedUrlTtlSeconds:SIGNED_URL_TTL_SECONDS});
  }catch(error){return apiError(error)}
}

export async function POST(request:Request){
  try{
    const token=await readAdminToken();
    if(!token)return NextResponse.json({error:'ADMIN_AUTH_INVALID'},{status:401});
    const body=updateSchema.parse(await request.json());
    const sb=getSupabaseServer();
    const {data,error}=await sb.rpc('character2_admin_feedback_status',{p_token:token,p_id:body.id,p_status:body.status});
    if(error){if(error.message?.includes('ADMIN_AUTH_INVALID'))return NextResponse.json({error:'ADMIN_AUTH_INVALID'},{status:401});throw error}
    if(data!==true)return NextResponse.json({error:'FEEDBACK_NOT_FOUND'},{status:404});
    return NextResponse.json({ok:true});
  }catch(error){return apiError(error)}
}
