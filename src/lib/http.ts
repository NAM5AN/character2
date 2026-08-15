import { NextResponse } from 'next/server';

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  if (message === 'CODE_INVALID') return NextResponse.json({ error: 'CODE_INVALID' }, { status: 401 });
  if (message === 'RATE_LIMITED') return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  if (message.includes('NOT_CONFIGURED')) return NextResponse.json({ error: message }, { status: 503 });
  console.error(error);
  return NextResponse.json({ error: message.split(':')[0] || 'SERVER_ERROR' }, { status: 500 });
}
