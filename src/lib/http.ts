import { NextResponse } from 'next/server';

function structuredError(message:string){
  const colon=message.indexOf(':');
  const rawCode=(colon>=0?message.slice(0,colon):message).trim();
  const code=/^[A-Z0-9_./-]{2,80}$/.test(rawCode)?rawCode:'SERVER_ERROR';
  const rawDetails=(colon>=0?message.slice(colon+1):code==='SERVER_ERROR'?message:'').trim();
  const details=rawDetails?rawDetails.slice(0,1400):'';
  return {code,details};
}

export type ApiErrorPayload = { status: number; body: { error: string; details?: string } };

// Maps a thrown error to the same {status, body} that apiError would return, so both
// JSON responses and streaming responses report errors identically.
export function apiErrorPayload(error: unknown): ApiErrorPayload {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  if (message === 'CODE_INVALID' || message.includes('CODE_INVALID')) {
    return { status: 401, body: { error: 'CODE_INVALID' } };
  }
  if (message === 'RATE_LIMITED') return { status: 429, body: { error: 'RATE_LIMITED' } };
  if (message.includes('DETAIL_ACCESS_DENIED')) {
    return { status: 403, body: { error: 'DETAIL_ACCESS_DENIED' } };
  }
  if (message.includes('DETAIL_ENTITLEMENT_ALREADY_CLAIMED')) {
    return {
      status: 409,
      body: {
        error: 'DETAIL_OWNER_SOURCE_REQUIRED',
        details: '이미 다른 브라우저에 상세 리포트 열람 권한이 저장되어 있어요. 캐릭터를 만든 브라우저에서 다시 열어주세요.',
      },
    };
  }

  const { code, details } = structuredError(message);
  if (message.includes('NOT_CONFIGURED')) {
    return { status: 503, body: { error: code, ...(details ? { details } : {}) } };
  }

  console.error(error);
  return { status: 500, body: { error: code, ...(details ? { details } : {}) } };
}

export function apiError(error: unknown) {
  const { status, body } = apiErrorPayload(error);
  return NextResponse.json(body, { status });
}
