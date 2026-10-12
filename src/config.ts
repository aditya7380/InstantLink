import os from 'node:os';
import path from 'node:path';

export interface Config {
  dataDir: string;
  publicHost: string;
  publicPort: number;
  adminPort: number;
  publicBaseUrl: string;
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function port(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`${name} must be a port number between 0 and 65535 (got "${raw}")`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicPort = port('IL_PUBLIC_PORT', 8080, env);
  const baseRaw = (env.IL_PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (baseRaw) {
    let u: URL;
    try {
      u = new URL(baseRaw);
    } catch {
      throw new Error(`IL_PUBLIC_BASE_URL is not a valid URL: "${baseRaw}"`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('IL_PUBLIC_BASE_URL must start with https:// (or http:// for local testing)');
    }
  }
  return {
    dataDir: expandHome(env.IL_DATA_DIR || '~/.instantlink'),
    publicHost: env.IL_PUBLIC_HOST || '127.0.0.1',
    publicPort,
    adminPort: port('IL_ADMIN_PORT', 8081, env),
    publicBaseUrl: baseRaw || `http://localhost:${publicPort}`,
  };
}
