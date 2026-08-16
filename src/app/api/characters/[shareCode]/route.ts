import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { characterPassportSchema } from '@/lib/schemas/character';
import { buildCharacterReportPreview } from '@/lib/character-report';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

async function loadPassport(rawCode: string) {
  const shareCode = normalizeShareCode(rawCode);
  if (!isShareCode(shareCode)) return { error: 'INVALID_SHARE_CODE' as const, status: 400 as const, passport: null };
  const supabase = getSupabaseServer();
  const { data, error } = await supabase.rpc('character2_get_character', { p_share_code: shareCode });
  if (error) throw error;
  if (!data) return { error: 'CHARACTER_NOT_FOUND' as const, status: 404 as const, passport: null };
  const passport = characterPassportSchema.parse(data);
  return { error: null, status: 200 as const, passport };
}

export async function GET(_request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    const { shareCode: raw } = await context.params;
    const loaded = await loadPassport(raw);
    if (!loaded.passport) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    return NextResponse.json({ preview: buildCharacterReportPreview(loaded.passport) });
  } catch (error) {
    return apiError(error);
  }
}

const detailSchema = z.object({ accessCode: z.string().min(1) });

export async function POST(request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    await assertRateLimit('character_detail_unlock', 30, 60);
    const { shareCode: raw } = await context.params;
    const body = detailSchema.parse(await request.json());
    if (!(await validateAccessCode(body.accessCode))) throw new Error('CODE_INVALID');

    const loaded = await loadPassport(raw);
    if (!loaded.passport) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    const passport = loaded.passport;

    return NextResponse.json({
      detail: {
        analysis: passport.analysis,
        confirmedFactCount: passport.confirmedFacts.length,
        inferenceCount: passport.aiInferences.filter(x => x.ownerVerdict !== 'rejected').length,
      },
    });
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
