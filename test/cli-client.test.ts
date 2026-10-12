import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminRequestInit } from '../src/adminClient.js';
import { makeEnv, writeRandom, type Env } from './helpers.js';

let env: Env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(() => env.close());

// Regression: `revoke` sent content-type JSON with no body and the server answered 400.
describe('admin client requests', () => {
  it('body-less requests carry no JSON content-type', () => {
    const init = adminRequestInit('POST', 'k');
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });
  it('requests with a body are JSON', () => {
    const init = adminRequestInit('POST', 'k', { a: 1 });
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });
  it('a body-less revoke, built exactly like the CLI does, succeeds against the real admin server', async () => {
    const f = path.join(env.dir, 'c.mp4');
    writeRandom(f, 100);
    const created = (await env.admin.inject({ method: 'POST', url: '/api/shares', payload: { path: f }, headers: { host: 'localhost', 'x-admin-key': env.adminKey } })).json();
    const init = adminRequestInit('POST', env.adminKey);
    const r = await env.admin.inject({ method: 'POST', url: `/api/shares/${created.id}/revoke`, headers: { host: 'localhost', ...(init.headers as Record<string, string>) } });
    expect(r.statusCode).toBe(200);
    expect(r.json().state).toBe('revoked');
  });
});
