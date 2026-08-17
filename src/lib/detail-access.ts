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
