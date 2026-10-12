import fs from 'node:fs';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Atomic "write temp file then rename". On Windows an antivirus scanner or the search indexer can hold the
 * target for a moment and make rename fail with EPERM/EBUSY, so retry briefly before giving up.
 */
export function renameWithRetry(from: string, to: string, attempts = 8, delayMs = 25, rename: (a: string, b: string) => void = fs.renameSync): void {
  for (let i = 0; ; i++) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (i >= attempts - 1 || !RETRYABLE.has(code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs * (i + 1));
    }
  }
}
