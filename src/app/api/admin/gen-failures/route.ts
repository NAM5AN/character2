import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

type DiagnosticExportRow = {
  recordType?: unknown;
  id?: unknown;
  eventAt?: unknown;
  startedAt?: unknown;
  stage?: unknown;
  shareCode?: unknown;
  sessionId?: unknown;
  operationId?: unknown;
  attemptId?: unknown;
  model?: unknown;
  errorCode?: unknown;
  errorDetail?: unknown;
  minutesStuck?: unknown;
  characterName?: unknown;
  ownerName?: unknown;
};

function text(value: unknown) {
  return value == null ? '' : String(value);
}

function csvCell(value: unknown) {
  let valueText = text(value).replace(/\r\n?/g, '\n');
  // Prevent spreadsheet formula injection from model/user supplied text.
  if (/^[=+\-@]/.test(valueText)) valueText = `'${valueText}`;
  return `"${valueText.replace(/"/g, '""')}"`;
}

function formatKst(value: unknown) {
  const raw = text(value);
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(date);
}

function stageLabel(stageValue: unknown) {
  const stage = text(stageValue);
  if (stage === 'profile_image') return '프로필 이미지 분석';
  if (stage === 'profile_parse') return '프로필 해석';
  if (stage === 'summary_psychology') return '요약 · 심리분석';
  if (stage === 'summary_teaser') return '요약 · 작성';
  if (stage.startsWith('questions')) return '질문 생성';
  if (stage === 'detail_stage_1') return '상세 · 1단계';
  if (stage === 'detail_stage_rest') return '상세 · 나머지';
  const detailMatch = stage.match(/^detail_stage_(\d+)$/);
  if (detailMatch) return `상세 · ${detailMatch[1]}단계`;
  if (stage.startsWith('detail')) return '상세 리포트';
  return stage;
}

function recordTypeLabel(value: unknown) {
  const kind = text(value);
  if (kind === 'retry') return '재시도';
  if (kind === 'timeout') return '타임아웃/강제종료 추정';
  return '실패';
}

async function exportCsv(token: string) {
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc('character2_admin_gen_diagnostics_export', {
    p_token: token,
    p_limit: 5000,
  });
  if (error) {
    if (error.message?.includes('ADMIN_AUTH_INVALID')) {
      return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    }
    throw error;
  }

  const rows = Array.isArray(data) ? data as DiagnosticExportRow[] : [];
  const headers = [
    '기록종류', '발생시간(KST)', '발생시간(ISO)', '단계', '단계코드',
    '캐릭터명', '오너명', '공유코드', '모델', '오류코드', '오류내용/로그',
    '타임아웃 경과(분)', '세션ID', '작업ID', '시도ID', '기록ID',
  ];
  const lines = [
    headers.map(csvCell).join(','),
    ...rows.map(row => [
      recordTypeLabel(row.recordType),
      formatKst(row.eventAt),
      text(row.eventAt),
      stageLabel(row.stage),
      text(row.stage),
      text(row.characterName),
      text(row.ownerName),
      text(row.shareCode),
      text(row.model),
      text(row.errorCode),
      text(row.errorDetail),
      text(row.minutesStuck),
      text(row.sessionId),
      text(row.operationId),
      text(row.attemptId),
      text(row.id),
    ].map(csvCell).join(',')),
  ];
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  const filename = `cha-lab_ai-diagnostics_${part('year')}-${part('month')}-${part('day')}.csv`;

  return new Response(`\uFEFF${lines.join('\r\n')}`, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

// Owner-only: recent AI generation failures/retries/timeouts for the admin console.
export async function GET(request: Request) {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });

    const url = new URL(request.url);
    if (url.searchParams.get('export') === 'csv') return await exportCsv(token);

    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_admin_gen_failures', { p_token: token, p_limit: 100 });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }
    return NextResponse.json({ failures: data ?? null });
  } catch (error) {
    return apiError(error);
  }
}

const deleteSchema = z.object({
  all: z.boolean().optional().default(false),
  ids: z.array(z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)).max(100).optional().default([]),
});

// all=true clears terminal failures + retry diagnostics + already-stale timeout/crash
// heartbeats. Active in-flight generation rows are never removed.
export async function DELETE(request: Request) {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const body = deleteSchema.parse(await request.json().catch(() => ({})));
    if (!body.all && body.ids.length === 0) {
      return NextResponse.json({ error: 'FAILURE_IDS_REQUIRED' }, { status: 400 });
    }

    const sb = getSupabaseServer();
    const result = body.all
      ? await sb.rpc('character2_admin_clear_gen_diagnostics', { p_token: token })
      : await sb.rpc('character2_admin_delete_gen_failures', {
          p_token: token,
          p_ids: body.ids,
          p_all: false,
        });
    const { data, error } = result;
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, deleted: Number(data || 0) });
  } catch (error) {
    return apiError(error);
  }
}
