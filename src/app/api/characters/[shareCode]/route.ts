import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { sha256 } from '@/lib/crypto';
import { apiError } from '@/lib/http';

export async function GET(_request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    const { shareCode: raw } = await context.params;
    const shareCode = normalizeShareCode(raw);
    if (!isShareCode(shareCode)) return NextResponse.json({ error: 'INVALID_SHARE_CODE' }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { data: character, error } = await supabase.from('characters').select('id, share_code').eq('share_code', shareCode).maybeSingle();
    if (error) throw error;
    if (!character) return NextResponse.json({ error: 'CHARACTER_NOT_FOUND' }, { status: 404 });
    const { data: passport, error: pError } = await supabase.from('character_passports').select('passport_json').eq('character_id', character.id).single();
    if (pError) throw pError;
    return NextResponse.json({ passport: passport.passport_json });
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
    const supabase = getSupabaseAdmin();
    const { data: character } = await supabase.from('characters').select('id').eq('share_code', shareCode).maybeSingle();
    if (!character) return NextResponse.json({ error: 'CHARACTER_NOT_FOUND' }, { status: 404 });
    const { data: access } = await supabase.from('character_access').select('edit_token_hash').eq('character_id', character.id).maybeSingle();
    if (!access || sha256(body.editToken) !== access.edit_token_hash) {
      return NextResponse.json({ error: 'EDIT_TOKEN_INVALID' }, { status: 403 });
    }
    const { error } = await supabase.from('characters').delete().eq('id', character.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
