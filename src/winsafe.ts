import path from 'node:path';

/** Windows device names that must never be opened (CON, NUL, COM1 ... with or without an extension). */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"|?*\u0000-\u001f]/;
const WINDOWS_HIDDEN = new Set(['desktop.ini', 'thumbs.db', '$recycle.bin', 'system volume information']);

/**
 * Names Windows treats specially. A ":" in a name means an NTFS "alternate data stream" (file.mp4:secret),
 * a trailing dot/space is silently stripped, and device names open hardware, so none of these may be served.
 */
export function isUnsafeWindowsName(name: string): boolean {
  return FORBIDDEN_CHARS.test(name) || /[. ]$/.test(name) || RESERVED.test(name);
}

/** Entries that are never listed or served from a shared folder. */
export function isHiddenName(name: string, platform: NodeJS.Platform = process.platform): boolean {
  if (name.startsWith('.')) return true;
  if (platform !== 'win32') return false;
  const lower = name.toLowerCase();
  return WINDOWS_HIDDEN.has(lower) || lower.startsWith('ntuser.dat') || isUnsafeWindowsName(name);
}

/** True when `real` is `root` or inside it. Case-insensitive on Windows; works when root is a drive root like C:\ . */
export function isInside(root: string, real: string, platform: NodeJS.Platform = process.platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const norm = (s: string) => (platform === 'win32' ? s.toLowerCase() : s);
  const r = norm(root);
  const x = norm(real);
  if (x === r) return true;
  const prefix = r.endsWith(p.sep) ? r : r + p.sep;
  return x.startsWith(prefix);
}

/**
 * Refuse folders that would expose far more than a person intends: a whole drive (C:\ or /),
 * the home folder (contains AppData, browser profiles, documents) or any folder that contains the home folder (C:\Users).
 */
export function isTooBroadFolder(real: string, home: string, platform: NodeJS.Platform = process.platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (p.parse(real).root === real) return true;
  return isInside(real, home, platform);
}
