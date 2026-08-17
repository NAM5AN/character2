import { NextResponse } from 'next/server';

function structuredError(message:string){
  const colon=message.indexOf(':');
  const rawCode=(colon>=0?message.slice(0,colon):message).trim();
  const code=/^[A-Z0-9_./-]{2,80}$/.test(rawCode)?rawCode:'SERVER_ERROR';
  const rawDetails=(colon>=0?message.slice(colon+1):code==='SERVER_ERROR'?message:'').trim();
  const details=rawDetails?rawDetails.slice(0,1400):'';
  return {code,details};
}

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  if (message === 'CODE_INVALID' || message.includes('CODE_INVALID')) {
    return NextResponse.json({ error: 'CODE_INVALID' }, { status: 401 });
  }
  if (message === 'RATE_LIMITED') return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  if (message.includes('DETAIL_ACCESS_DENIED')) {
    return NextResponse.json({ error: 'DETAIL_ACCESS_DENIED' }, { status: 403 });
  }
  if (message.includes('DETAIL_ENTITLEMENT_ALREADY_CLAIMED')) {
    return NextResponse.json({
      error: 'DETAIL_OWNER_SOURCE_REQUIRED',
      details: '이미 다른 브라우저에 상세 리포트 열람 권한이 저장되어 있어요. 캐릭터를 만든 브라우저에서 다시 열어주세요.',
    }, { status: 409 });
  }

  const {code,details}=structuredError(message);
  if (message.includes('NOT_CONFIGURED')) {
    return NextResponse.json({ error: code, ...(details?{details}:{}) }, { status: 503 });
  }

  console.error(error);
  return NextResponse.json({ error: code, ...(details?{details}:{}) }, { status: 500 });
}
