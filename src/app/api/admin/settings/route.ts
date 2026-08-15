import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { sha256 } from '@/lib/crypto';
import { apiError } from '@/lib/http';

const schema = z.object({
  adminSecret: z.string().min(1),
  postypeUrl: z.string().url().or(z.literal('')),
  accessCode: z.string().min(4).max(32),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    if (!process.env.ADMIN_SECRET || body.adminSecret !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: 'ADMIN_SECRET_INVALID' }, { status: 401 });
    }
    const supabase = getSupabaseAdmin();
    const { data: current } = await supabase.from('app_settings').select('code_version').eq('id', 1).maybeSingle();
    const { error } = await supabase.from('app_settings').upsert({
      id: 1,
      postype_url: body.postypeUrl,
      ai_access_code_hash: sha256(body.accessCode.trim()),
      code_version: (current?.code_version ?? 0) + 1,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, codeVersion: (current?.code_version ?? 0) + 1 });
  } catch (error) {
    return apiError(error);
  }
}
