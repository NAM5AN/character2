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
  if (message === 'CODE_INVALID') return NextResponse.json({ error: 'CODE_INVALID' }, { status: 401 });
  if (message === 'RATE_LIMITED') return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });

  const {code,details}=structuredError(message);
  if (message.includes('NOT_CONFIGURED')) {
    return NextResponse.json({ error: code, ...(details?{details}:{}) }, { status: 503 });
  }

  console.error(error);
  return NextResponse.json({ error: code, ...(details?{details}:{}) }, { status: 500 });
}
