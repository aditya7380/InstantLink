import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/range.js';

describe('parseRange', () => {
  it('no header -> full', () => expect(parseRange(undefined, 100)).toEqual({ kind: 'full' }));
  it('bytes=0-9', () => expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'partial', start: 0, end: 9 }));
  it('open ended', () => expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'partial', start: 90, end: 99 }));
  it('suffix', () => expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'partial', start: 90, end: 99 }));
  it('suffix larger than file', () => expect(parseRange('bytes=-500', 100)).toEqual({ kind: 'partial', start: 0, end: 99 }));
  it('end clamped to size', () => expect(parseRange('bytes=50-5000', 100)).toEqual({ kind: 'partial', start: 50, end: 99 }));
  it('start beyond size -> 416', () => expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' }));
  it('suffix 0 -> 416', () => expect(parseRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' }));
  it('empty file -> 416', () => expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' }));
  it('end before start -> ignored', () => expect(parseRange('bytes=10-5', 100)).toEqual({ kind: 'full' }));
  it('multi range -> full', () => expect(parseRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'full' }));
  it('garbage / other unit -> full', () => {
    expect(parseRange('lines=1-2', 100)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=abc', 100)).toEqual({ kind: 'full' });
  });
  it('huge numbers do not crash', () => expect(parseRange('bytes=99999999999999999999-', 100)).toEqual({ kind: 'unsatisfiable' }));
});
