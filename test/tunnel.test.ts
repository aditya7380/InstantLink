import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeEnv, rawGet, type Env } from './helpers.js';
import { CloudflareTunnel, bindTunnelToConfig, findBinary } from '../src/tunnel.js';
import { clientKey } from '../src/server.js';
import { buildAdminServer } from '../src/admin.js';

/*
 * These tests use small FAKE "cloudflared" scripts. They verify our parsing, state machine, failure handling and
 * reachability check against a real local server. They do NOT prove anything about the real Cloudflare network.
 */
let env: Env;
let bin: string;
const LOCAL = /http:\/\/127\.0\.0\.1:\d+/;

function fake(name: string, body: string): string {
  const f = path.join(env.dir, name);
  fs.writeFileSync(f, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return f;
}

beforeAll(async () => {
  env = await makeEnv();
  bin = fake('fake-ok', `console.error("INF Requesting new quick Tunnel");\nconsole.error("INF |  http://127.0.0.1:" + process.argv[2] + "  |");\nsetInterval(()=>{}, 1000);`);
});
afterAll(() => env.close());

const mk = (binary: string, extra: Record<string, unknown> = {}) =>
  new CloudflareTunnel({ binary, localPort: env.cfg.publicPort, urlPattern: LOCAL, reachabilityDelayMs: 50, reachabilityAttempts: 3, ...extra });

describe('tunnel manager', () => {
  it('goes starting -> connected, then verifies the public route reaches OUR server', async () => {
    const t = mk(bin, { args: [String(env.cfg.publicPort)] });
    const seen: string[] = [];
    t.onChange((s) => seen.push(`${s.state}/${s.reachability}`));
    const s = await t.start();
    expect(s.state).toBe('connected');
    expect(s.url).toBe(`http://127.0.0.1:${env.cfg.publicPort}`);
    expect(s.note).toContain('phone');
    await new Promise((r) => setTimeout(r, 400));
    expect(t.status().reachability).toBe('reachable');
    expect(seen[0]).toBe('starting/unchecked');
    await t.stop();
    expect(t.status().state).toBe('off');
  });

  it('reports "unreachable" (not success) when the URL does not answer', async () => {
    const dead = fake('fake-dead', `console.error("http://127.0.0.1:1");\nsetInterval(()=>{}, 1000);`);
    const t = mk(dead);
    await t.start();
    await new Promise((r) => setTimeout(r, 1500));
    expect(t.status().state).toBe('connected'); // a URL was printed...
    expect(t.status().reachability).toBe('unreachable'); // ...but we did not pretend it works
    await t.stop();
  });

  it('missing program gives install instructions', async () => {
    const t = new CloudflareTunnel({ localPort: 1, env: { PATH: '/nonexistent' } });
    const s = await t.start();
    expect(s.state).toBe('failed');
    expect(s.error).toContain('not installed');
  });

  it('program that exits early -> failed with the last error line', async () => {
    const crash = fake('fake-crash', `console.error("ERR failed to request quick Tunnel: dial tcp: lookup api.trycloudflare.com");\nprocess.exit(1);`);
    const s = await mk(crash).start();
    expect(s.state).toBe('failed');
    expect(s.error).toContain('trycloudflare');
    expect(s.url).toBeNull();
  });

  // Regression: real cloudflared printed its API URL inside an error line and we reported "connected" to it.
  it('does not mistake a URL inside an error message for the public address', async () => {
    const real = fake('fake-real-error', `console.error('2026-10-11T05:00:00Z ERR Error unmarshaling QuickTunnel response: error="Post \\"https://api.trycloudflare.com/tunnel\\": dial tcp: i/o timeout"');\nprocess.exit(1);`);
    const t = new CloudflareTunnel({ binary: real, localPort: 1 }); // default (real) URL pattern
    const s = await t.start();
    expect(s.state).toBe('failed');
    expect(s.url).toBeNull();
    expect(s.error).toContain('api.trycloudflare.com');
  });

  it('default pattern accepts a genuine quick-tunnel address and rejects the API host', async () => {
    const ok = fake('fake-real-ok', `console.error('INF |  https://random-words-here.trycloudflare.com  |');\nsetInterval(()=>{},1000);`);
    const t = new CloudflareTunnel({ binary: ok, localPort: 1, reachabilityAttempts: 1, reachabilityDelayMs: 10 });
    const s = await t.start();
    expect(s.url).toBe('https://random-words-here.trycloudflare.com');
    await t.stop();
  });

  it('times out when no address ever appears, and kills the process', async () => {
    const silent = fake('fake-silent', `setInterval(()=>{}, 1000);`);
    const s = await mk(silent, { startTimeoutMs: 400 }).start();
    expect(s.state).toBe('failed');
    expect(s.error).toContain('Timed out');
  });

  it('connection drop after connecting -> disconnected, and links fall back to the local base', async () => {
    const drop = fake('fake-drop', `console.error("http://127.0.0.1:" + process.argv[2]);\nsetTimeout(()=>process.exit(0), 300);`);
    const t = mk(drop, { args: [String(env.cfg.publicPort)] });
    const cfg = { publicBaseUrl: 'http://localhost:8080' };
    bindTunnelToConfig(cfg, t, 'http://localhost:8080');
    await t.start();
    expect(cfg.publicBaseUrl).toBe(`http://127.0.0.1:${env.cfg.publicPort}`);
    await new Promise((r) => setTimeout(r, 900));
    expect(t.status().state).toBe('disconnected');
    expect(t.status().error).toContain('dropped');
    expect(cfg.publicBaseUrl).toBe('http://localhost:8080');
  });

  it('findBinary honours IL_CLOUDFLARED_PATH and PATH', () => {
    expect(findBinary('x', { IL_CLOUDFLARED_PATH: bin })).toBe(bin);
    expect(findBinary('fake-ok', { PATH: env.dir })).toBe(bin);
    expect(findBinary('definitely-missing-program', { PATH: env.dir })).toBeNull();
  });
});

describe('admin status / tunnel endpoints', () => {
  const call = (app: ReturnType<typeof buildAdminServer>, method: 'GET' | 'POST', url: string) =>
    app.inject({ method, url, headers: { host: 'localhost', 'x-admin-key': env.adminKey } });

  it('tunnel endpoints answer 501 when no tunnel is configured; status says link is local only', async () => {
    expect((await call(env.admin, 'POST', '/api/tunnel/start')).statusCode).toBe(501);
    const st = (await call(env.admin, 'GET', '/api/status')).json();
    expect(st.publicBaseIsLocal).toBe(true);
    expect(st.tunnel).toBeNull();
  });

  it('start/stop work through the API and the link base follows the tunnel', async () => {
    const t = mk(bin, { args: [String(env.cfg.publicPort)] });
    const cfg = { ...env.cfg, publicBaseUrl: 'http://localhost:1' };
    bindTunnelToConfig(cfg, t, cfg.publicBaseUrl);
    const app = buildAdminServer(env.store, cfg, env.adminKey, false, t);
    const started = (await call(app, 'POST', '/api/tunnel/start')).json();
    expect(started.state).toBe('connected');
    const st = (await call(app, 'GET', '/api/status')).json();
    expect(st.publicBaseUrl).toBe(started.url);
    const stopped = (await call(app, 'POST', '/api/tunnel/stop')).json();
    expect(stopped.state).toBe('off');
    expect((await call(app, 'GET', '/api/status')).json().publicBaseUrl).toBe('http://localhost:1');
    await app.close();
  });
});

describe('rate limiting behind the tunnel', () => {
  it('clientKey trusts CF-Connecting-IP only from loopback and only if well-formed', () => {
    expect(clientKey('127.0.0.1', '203.0.113.9', 'fallback')).toBe('203.0.113.9');
    expect(clientKey('::ffff:127.0.0.1', '2001:db8::1', 'fallback')).toBe('2001:db8::1');
    expect(clientKey('192.168.1.50', '203.0.113.9', '192.168.1.50')).toBe('192.168.1.50'); // LAN client cannot spoof
    expect(clientKey('8.8.8.8', '1.2.3.4', '8.8.8.8')).toBe('8.8.8.8');
    expect(clientKey('127.0.0.1', '<script>', 'fb')).toBe('fb');
    expect(clientKey('127.0.0.1', 'x'.repeat(100), 'fb')).toBe('fb');
    expect(clientKey('127.0.0.1', undefined, 'fb')).toBe('fb');
  });

  it('one abusive visitor does not lock out other visitors', async () => {
    const e2 = await makeEnv({ rateLimitMax: 4 });
    try {
      const a: number[] = [];
      for (let i = 0; i < 8; i++) a.push((await rawGet(e2.base, '/s/guess/file', { 'cf-connecting-ip': '198.51.100.1' })).status);
      expect(a).toContain(429);
      const b = await rawGet(e2.base, '/s/guess/file', { 'cf-connecting-ip': '198.51.100.2' });
      expect(b.status).toBe(404); // visitor B is unaffected (before the fix both shared 127.0.0.1)
    } finally {
      await e2.close();
    }
  });
});
