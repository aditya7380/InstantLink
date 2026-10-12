import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type TunnelState = 'off' | 'starting' | 'connected' | 'failed' | 'disconnected';
/** "reachable" only means: a request sent to the public URL came back from OUR server. */
export type Reachability = 'unchecked' | 'checking' | 'reachable' | 'unreachable';

export interface TunnelStatus {
  state: TunnelState;
  url: string | null;
  error: string | null;
  reachability: Reachability;
  checkedAt: number | null;
  /** Always spelled out so the UI never overstates what was verified. */
  note: string;
}

export interface TunnelController {
  status(): TunnelStatus;
  start(): Promise<TunnelStatus>;
  stop(): Promise<void>;
  onChange(fn: (s: TunnelStatus) => void): void;
}

export interface TunnelOptions {
  localPort: number;
  binary?: string;
  /** Matches the public URL in the tunnel program's output. */
  urlPattern?: RegExp;
  args?: string[];
  startTimeoutMs?: number;
  reachabilityAttempts?: number;
  reachabilityDelayMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Extra folders to search; the first one is shown to the user as "put it here". */
  extraDirs?: string[];
}

// Never match Cloudflare's own API host (it appears inside error messages).
const DEFAULT_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;
const ERROR_LINE = /\b(ERR|error|failed)\b/i;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const NOTE = 'Checked from this computer through the public address. Open the link on a phone using mobile data to confirm for real.';

export interface FindOptions { platform?: NodeJS.Platform; extraDirs?: string[] }

/**
 * Look for the program: explicit override, then PATH, then extra folders (e.g. next to InstantLink),
 * then the usual Windows install folders. On Windows only .exe is tried: a .cmd cannot be started without a shell.
 */
export function findBinary(name: string, env: NodeJS.ProcessEnv = process.env, opts: FindOptions = {}): string | null {
  const platform = opts.platform ?? process.platform;
  if (env.IL_CLOUDFLARED_PATH && fs.existsSync(env.IL_CLOUDFLARED_PATH)) return env.IL_CLOUDFLARED_PATH;
  const win = platform === 'win32';
  const exts = win ? ['.exe', ''] : [''];
  // Windows names the variable "Path"; a plain object copy of process.env is case-sensitive.
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path');
  const pathVar = pathKey ? (env[pathKey] ?? '') : '';
  const dirs = pathVar.split(win ? ';' : path.delimiter).map((d) => d.replace(/^"|"$/g, '')).filter(Boolean);
  dirs.push(...(opts.extraDirs ?? []));
  if (win) {
    for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles]) if (base) dirs.push(path.join(base, 'cloudflared')); // usual MSI location (unverified)
  }
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        if (fs.statSync(p).isFile()) return p;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

function notInstalledMessage(helpDir: string | undefined): string {
  if (process.platform === 'win32') {
    return 'The "cloudflared" program is not installed (or could not be found). Download "cloudflared-windows-amd64.exe" from https://github.com/cloudflare/cloudflared/releases/latest , '
      + `rename it to cloudflared.exe and put it in this folder: ${helpDir ?? 'the InstantLink folder'} , then try again. Alternatively set IL_CLOUDFLARED_PATH to the full path of cloudflared.exe.`;
  }
  return 'The "cloudflared" program is not installed (or could not be found). Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and restart InstantLink. Alternatively set IL_CLOUDFLARED_PATH to the full path of the program.';
}

/** Runs `cloudflared` as a child process: a Cloudflare "quick tunnel" that forwards the public HTTPS URL to our PUBLIC server only. */
export class CloudflareTunnel implements TunnelController {
  private proc: ChildProcess | null = null;
  private listeners: ((s: TunnelStatus) => void)[] = [];
  private st: TunnelStatus = { state: 'off', url: null, error: null, reachability: 'unchecked', checkedAt: null, note: NOTE };
  private generation = 0;

  constructor(private opts: TunnelOptions) {}

  status(): TunnelStatus {
    return { ...this.st };
  }

  onChange(fn: (s: TunnelStatus) => void) {
    this.listeners.push(fn);
  }

  private set(patch: Partial<TunnelStatus>) {
    this.st = { ...this.st, ...patch };
    for (const l of this.listeners) l(this.status());
  }

  async start(): Promise<TunnelStatus> {
    if (this.st.state === 'starting' || this.st.state === 'connected') return this.status();
    const gen = ++this.generation;
    const bin = this.opts.binary ?? findBinary('cloudflared', this.opts.env ?? process.env, { extraDirs: this.opts.extraDirs });
    if (!bin) {
      this.set({
        state: 'failed', url: null, reachability: 'unchecked',
        error: notInstalledMessage(this.opts.extraDirs?.[0]),
      });
      return this.status();
    }
    this.set({ state: 'starting', url: null, error: null, reachability: 'unchecked', checkedAt: null });
    const pattern = this.opts.urlPattern ?? DEFAULT_URL;
    const args = this.opts.args ?? ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.opts.localPort}`];
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: this.opts.env ?? process.env });
    this.proc = proc;

    return new Promise<TunnelStatus>((resolve) => {
      let settled = false;
      let lastError = '';
      const finish = (patch: Partial<TunnelStatus>) => {
        if (settled || gen !== this.generation) return;
        settled = true;
        clearTimeout(timer);
        this.set(patch);
        resolve(this.status());
      };
      const onData = (buf: Buffer) => {
        const lines = buf.toString().split('\n');
        for (const line of lines) {
          if (ERROR_LINE.test(line)) {
            lastError = line.replace(ANSI, '').slice(0, 300);
            continue; // a URL inside an error message is not our public address
          }
          const m = pattern.exec(line);
          if (m && !settled) {
            finish({ state: 'connected', url: m[0], error: null, reachability: 'checking' });
            void this.checkReachability(gen);
          }
        }
      };
      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('error', (e) => finish({ state: 'failed', error: `Could not start the tunnel program: ${e.message}` }));
      proc.on('exit', (code) => {
        if (gen !== this.generation) return;
        if (!settled) {
          finish({ state: 'failed', error: `The tunnel program stopped before a public address was ready (exit ${code}). ${lastError ? 'Last message: ' + lastError : 'Check your internet connection.'}` });
        } else if (this.st.state === 'connected') {
          this.set({ state: 'disconnected', url: null, reachability: 'unchecked', checkedAt: null, error: 'The public connection dropped. Links stopped working for other people. Start sharing again to get a new public address.' });
        }
      });
      const timer = setTimeout(() => {
        finish({ state: 'failed', error: 'Timed out waiting for a public address. Your network may block Cloudflare. ' + (lastError ? `Last message: ${lastError}` : '') });
        proc.kill();
      }, this.opts.startTimeoutMs ?? 30_000);
    });
  }

  private async checkReachability(gen: number) {
    const attempts = this.opts.reachabilityAttempts ?? 10;
    const delay = this.opts.reachabilityDelayMs ?? 2000;
    for (let i = 0; i < attempts; i++) {
      if (gen !== this.generation || this.st.state !== 'connected' || !this.st.url) return;
      try {
        const r = await fetch(`${this.st.url}/healthz`, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
        const body = (await r.json().catch(() => null)) as { ok?: boolean } | null;
        if (r.status === 200 && body?.ok === true) {
          if (gen === this.generation && this.st.state === 'connected') this.set({ reachability: 'reachable', checkedAt: Date.now() });
          return;
        }
      } catch { /* DNS for a brand-new hostname can take a few seconds */ }
      await new Promise((r) => setTimeout(r, delay));
    }
    if (gen === this.generation && this.st.state === 'connected') this.set({ reachability: 'unreachable', checkedAt: Date.now() });
  }

  async stop(): Promise<void> {
    this.generation++;
    const p = this.proc;
    this.proc = null;
    if (p && p.exitCode === null) {
      p.kill();
      await new Promise<void>((r) => { p.once('exit', () => r()); setTimeout(r, 3000); });
    }
    this.set({ state: 'off', url: null, error: null, reachability: 'unchecked', checkedAt: null });
  }
}

/** Keep the admin API's idea of "public base URL" in sync with the tunnel. */
export function bindTunnelToConfig(cfg: { publicBaseUrl: string }, tunnel: TunnelController, localBase: string) {
  tunnel.onChange((s) => {
    cfg.publicBaseUrl = s.state === 'connected' && s.url ? s.url : localBase;
  });
}
