import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { characterPassportSchema } from '@/lib/schemas/character';
import { apiError } from '@/lib/http';

export async function GET(_request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    const { shareCode: raw } = await context.params;
    const shareCode = normalizeShareCode(raw);
    if (!isShareCode(shareCode)) return NextResponse.json({ error: 'INVALID_SHARE_CODE' }, { status: 400 });
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_get_character', { p_share_code: shareCode });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'CHARACTER_NOT_FOUND' }, { status: 404 });
    const passport = characterPassportSchema.parse(data);
    return NextResponse.json({ passport });
  } catch (error) {
    return apiError(error);
  }
}

const deleteSchema = z.object({ editToken: z.string().min(16) });

export async function DELETE(request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    const { shareCode: raw } = await context.params;
    const shareCode = normalizeShareCode(raw);
    const body = deleteSchema.parse(await request.json());
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_delete_character', {
      p_share_code: shareCode,
      p_edit_token: body.editToken,
    });
    if (error) throw error;
    if (data !== true) return NextResponse.json({ error: 'EDIT_TOKEN_INVALID' }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
