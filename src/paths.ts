import fs from 'node:fs/promises';
import path from 'node:path';
import { isInside, isUnsafeWindowsName } from './winsafe.js';

export class PathError extends Error {
  constructor(public code: 'invalid' | 'outside' | 'missing' | 'not_file' | 'denied', message: string) {
    super(message);
  }
}

/**
 * Resolve a recipient-supplied relative path inside an authorized root.
 * Rejects NUL bytes, absolute paths, ".." segments, and symlinks that
 * escape the root (checked on the real path).
 */
export async function resolveInside(rootReal: string, requested: string): Promise<string> {
  if (requested.includes('\0') || requested.includes('\\')) throw new PathError('invalid', 'bad path');
  if (requested.startsWith('/')) throw new PathError('invalid', 'absolute path');
  const segments = requested.split('/').filter((s) => s !== '');
  if (segments.length === 0 || segments.some((s) => s === '..' || s === '.')) {
    throw new PathError('invalid', 'bad path');
  }
  if (process.platform === 'win32' && segments.some(isUnsafeWindowsName)) throw new PathError('invalid', 'bad path');
  const candidate = path.join(rootReal, ...segments);
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EACCES') throw new PathError('denied', 'permission denied');
    throw new PathError('missing', 'not found');
  }
  if (!isInside(rootReal, real)) {
    throw new PathError('outside', 'path escapes shared folder');
  }
  return real;
}

export async function statFile(real: string): Promise<{ size: number; mtimeMs: number }> {
  let st;
  try {
    st = await fs.stat(real);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw new PathError('denied', 'permission denied');
    throw new PathError('missing', 'not found');
  }
  if (!st.isFile()) throw new PathError('not_file', 'not a regular file');
  return { size: st.size, mtimeMs: st.mtimeMs };
}
