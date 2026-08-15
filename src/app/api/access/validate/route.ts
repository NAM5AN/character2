import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/http';
import { getAppSettings, validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';

const bodySchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  try {
    await assertRateLimit('access_validate', 20, 10);
    const body = bodySchema.parse(await request.json());
    const valid = await validateAccessCode(body.code);
    const settings = await getAppSettings();
    return NextResponse.json({ valid, postypeUrl: settings.postype_url || '' }, { status: valid ? 200 : 401 });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET() {
  try {
    const settings = await getAppSettings();
    return NextResponse.json({ postypeUrl: settings.postype_url || '', codeVersion: settings.code_version ?? 0 });
  } catch (error) {
    return apiError(error);
  }
}
