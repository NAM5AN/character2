import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertRateLimit } from '@/lib/rate-limit';
import { discoverProfileImages, loadProfileImage } from '@/lib/profile-images';
import { apiError } from '@/lib/http';

export const dynamic='force-dynamic';

const discoverSchema=z.object({
  urls:z.array(z.string().url().max(2200)).min(1).max(2),
});

export async function POST(request:Request){
  try{
    await assertRateLimit('profile_image_discover',24,60);
    const body=discoverSchema.parse(await request.json());
    const unique=[...new Set(body.urls.map(url=>url.trim()).filter(Boolean))].slice(0,2);
    const sources=[] as Awaited<ReturnType<typeof discoverProfileImages>>[];
    for(const url of unique){
      try{sources.push(await discoverProfileImages(url))}
      catch(error){
        console.info('PROFILE_IMAGE_DISCOVERY_SKIPPED',{url,message:error instanceof Error?error.message:String(error)});
      }
    }
    return NextResponse.json({sources});
  }catch(error){return apiError(error)}
}

const imageQuerySchema=z.object({
  url:z.string().url().max(2200),
  index:z.coerce.number().int().min(0).max(11),
});

export async function GET(request:Request){
  try{
    await assertRateLimit('profile_image_fetch',64,60);
    const requestUrl=new URL(request.url);
    const query=imageQuerySchema.parse({url:requestUrl.searchParams.get('url')||'',index:requestUrl.searchParams.get('index')||''});
    const image=await loadProfileImage(query.url,query.index);
    return new Response(image.bytes,{
      status:200,
      headers:{
        'content-type':image.contentType,
        'content-length':String(image.bytes.byteLength),
        'cache-control':'private, max-age=60',
        'x-content-type-options':'nosniff',
        'content-disposition':`inline; filename="${image.name.replace(/["\\\r\n]/gu,'_').slice(0,120)}"`,
      },
    });
  }catch(error){return apiError(error)}
}
