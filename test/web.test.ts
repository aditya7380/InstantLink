import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const web = path.resolve(import.meta.dirname, '..', 'web');
const read = (f: string) => fs.readFileSync(path.join(web, f), 'utf8');

function strings(): Record<string, Record<string, string>> {
  const src = read('app.js');
  const start = src.indexOf('var STRINGS = ') + 'var STRINGS = '.length;
  const end = src.indexOf('};\n\n  var MEDIA_EXT') + 1;
  return new Function(`return ${src.slice(start, end)}`)() as Record<string, Record<string, string>>;
}

describe('receiver website: privacy by construction', () => {
  const html = read('index.html');
  const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const headersCsp = /Content-Security-Policy:\s*(.+)/.exec(read('_headers'))?.[1] ?? '';

  it('forbids all network requests from the page (connect-src none) and only plays blob: media', () => {
    for (const csp of [meta, headersCsp]) {
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("connect-src 'none'");
      expect(csp).toContain('media-src blob:');
      expect(csp).toContain("form-action 'none'");
      expect(csp).not.toMatch(/unsafe-eval|unsafe-inline.*script|script-src[^;]*unsafe/);
    }
  });
  it('the hosting headers add only frame-ancestors on top of the meta policy', () => {
    expect(headersCsp.replace("; frame-ancestors 'none'", '')).toBe(meta);
  });
  it('loads nothing from other websites and contains no network calls', () => {
    for (const f of ['index.html', 'app.js', 'styles.css']) {
      const text = read(f).replace(/xmlns="[^"]*"/g, '');
      expect(text, f).not.toMatch(/https?:\/\//);
    }
    const js = read('app.js');
    for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'FormData', 'EventSource', 'importScripts', 'eval(']) {
      expect(js, bad).not.toContain(bad);
    }
  });
  it('plays through a local blob URL', () => {
    expect(read('app.js')).toContain('URL.createObjectURL');
  });
});

describe('receiver website: languages', () => {
  it('English and Hindi have exactly the same keys, none empty', () => {
    const s = strings();
    expect(Object.keys(s.hi).sort()).toEqual(Object.keys(s.en).sort());
    for (const lang of ['en', 'hi']) for (const [k, v] of Object.entries(s[lang]!)) expect(v.length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it('every data-i18n key used in the page exists', () => {
    const keys = [...read('index.html').matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) expect(strings().en[k], k).toBeDefined();
  });
  it('Hindi strings keep the same {placeholders} as English', () => {
    const s = strings();
    const ph = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const k of Object.keys(s.en)) expect(ph(s.hi![k]!), k).toBe(ph(s.en[k]!));
  });
});
