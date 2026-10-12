import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** 32-byte key kept next to the data (mode 0600). Created on first run. */
export function loadOrCreateSecretKey(dataDir: string): Buffer {
  const file = path.join(dataDir, 'secret.key');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    const k = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (k.length !== 32) throw new Error('secret.key is corrupted (expected 32 bytes). Delete it to reset; existing links become unrecoverable.');
    return k;
  }
  const key = randomBytes(32);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

/** AES-256-GCM. Output: base64(iv[12] | tag[16] | ciphertext). */
export function encryptText(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

/** Returns null if the data was tampered with or the key is wrong. */
export function decryptText(key: Buffer, blob: string): string | null {
  try {
    const raw = Buffer.from(blob, 'base64');
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
