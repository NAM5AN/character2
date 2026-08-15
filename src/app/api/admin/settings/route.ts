import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';

const schema = z.object({
  adminSecret: z.string().min(1),
  postypeUrl: z.string().url().or(z.literal('')),
  accessCode: z.string().min(4).max(32),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_update_settings', {
      p_admin_secret: body.adminSecret,
      p_postype_url: body.postypeUrl,
      p_access_code: body.accessCode,
    });
    if (error) {
      if (error.message?.includes('ADMIN_SECRET_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_SECRET_INVALID' }, { status: 401 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, codeVersion: data });
  } catch (error) {
    return apiError(error);
  }
}
