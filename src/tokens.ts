import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits of randomness, URL-safe. Cannot be guessed. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateId(): string {
  return randomBytes(8).toString('hex');
}

/** Only the hash is stored on disk; the raw token exists only in the link. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
