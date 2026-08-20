import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

function getDeploymentInfo() {
  const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || '';
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || '';
  const deploymentUrl = process.env.VERCEL_URL || '';
  const version = deploymentSha
    ? deploymentSha.slice(0, 7)
    : deploymentId
      ? deploymentId.replace(/^dpl_/, '').slice(0, 7)
      : deploymentUrl
        ? deploymentUrl.split('-').at(-2)?.slice(0, 7) || 'vercel'
        : 'local';
  const title = deploymentSha || deploymentId || deploymentUrl || 'local development';
  return { version, title };
}

export async function GET() {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });

    // Validate the cookie against the server-side admin session before exposing deployment metadata.
    const sb = getSupabaseServer();
    const { error } = await sb.rpc('character2_admin_get_settings', { p_token: token });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }

    return NextResponse.json({ ok: true, deployment: getDeploymentInfo() });
  } catch (error) {
    return apiError(error);
  }
}
