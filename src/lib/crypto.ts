import crypto from 'node:crypto';

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function createEditToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function createDetailViewToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
