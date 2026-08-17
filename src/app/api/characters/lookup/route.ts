import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';
import { ADMIN_COOKIE_NAME, adminCookieOptions, createAdminSessionToken } from '@/lib/admin-session';

const requestSchema=z.object({
  name:z.string().trim().min(1).max(80),
  ownerName:z.string().trim().min(1).max(80),
});

const lookupSchema=z.object({
  shareCode:z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
  name:z.string().min(1),
  ownerName:z.string().min(1),
});

export async function POST(request:Request){
  try{
    await assertRateLimit('character_human_lookup',24,10);
    const body=requestSchema.parse(await request.json());
    const sb=getSupabaseServer();

    // Owner-only management access is reached through this same form so the entry
    // point is not discoverable from the client bundle. The credential pair is
    // verified as a salted hash inside the database; nothing here reveals it.
    const adminToken=createAdminSessionToken();
    const {data:adminOk,error:adminError}=await sb.rpc('character2_admin_login',{
      p_name:body.name,
      p_owner_name:body.ownerName,
      p_token:adminToken,
    });
    if(adminError)throw adminError;
    if(adminOk===true){
      const response=NextResponse.json({admin:true});
      response.cookies.set(ADMIN_COOKIE_NAME,adminToken,adminCookieOptions());
      return response;
    }

    const {data,error}=await sb.rpc('character2_lookup_character',{p_name:body.name,p_owner_name:body.ownerName});
    if(error)throw error;
    if(!data)return NextResponse.json({error:'CHARACTER_NOT_FOUND'},{status:404});
    return NextResponse.json({character:lookupSchema.parse(data)});
  }catch(error){return apiError(error)}
}
