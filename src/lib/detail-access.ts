export const DETAIL_VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 730;

export function detailViewCookieName(shareCode: string) {
  return `chara_detail_${shareCode.toLowerCase()}`;
}

export function detailViewCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: DETAIL_VIEW_COOKIE_MAX_AGE,
  };
}

// 스트리밍 응답(Response)에는 NextResponse.cookies.set 을 쓸 수 없어 Set-Cookie 를 직접 만든다.
// 옵션은 detailViewCookieOptions 와 같은 값을 쓰므로 두 경로의 쿠키가 동일하다.
export function serializeDetailViewCookie(shareCode: string, token: string) {
  const options = detailViewCookieOptions();
  const parts = [
    `${detailViewCookieName(shareCode)}=${encodeURIComponent(token)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite === 'lax' ? 'Lax' : options.sameSite}`,
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
