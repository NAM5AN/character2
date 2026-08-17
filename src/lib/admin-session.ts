export const ADMIN_SESSION_COOKIE = 'character2_admin_session';
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 12;

export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE,
  };
}
