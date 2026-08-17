import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE_NAME = 'c2_admin';
const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 12; // 12h, mirrors the DB session lifetime.

export function createAdminSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ADMIN_COOKIE_MAX_AGE,
  };
}

export async function readAdminToken(): Promise<string> {
  const store = await cookies();
  return store.get(ADMIN_COOKIE_NAME)?.value?.trim() || '';
}
