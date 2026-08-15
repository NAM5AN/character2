import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateShareCode(): string {
  let result = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i += 1) {
    result += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return result;
}

export function normalizeShareCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function isShareCode(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{8}$/.test(value);
}
