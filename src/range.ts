export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/**
 * Parse a single HTTP Range header (RFC 9110). Multi-range requests are answered
 * with the full file, which the RFC allows.
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' };
  const m = /^bytes=(.+)$/i.exec(header.trim());
  if (!m || !m[1]) return { kind: 'full' };
  const spec = m[1];
  if (spec.includes(',')) return { kind: 'full' };
  const parts = /^(\d*)-(\d*)$/.exec(spec.trim());
  if (!parts) return { kind: 'full' };
  const [, a = '', b = ''] = parts;
  if (a === '' && b === '') return { kind: 'full' };
  if (size === 0) return { kind: 'unsatisfiable' };

  let start: number;
  let end: number;
  if (a === '') {
    // suffix: last N bytes
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n === 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Number(b);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: 'unsatisfiable' };
    if (b !== '' && end < start) return { kind: 'full' }; // invalid syntax -> ignore header
    if (start >= size) return { kind: 'unsatisfiable' };
    end = Math.min(end, size - 1);
  }
  return { kind: 'partial', start, end };
}
