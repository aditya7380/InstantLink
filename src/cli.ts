import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { ShareStore } from './store.js';
import { buildPublicServer } from './server.js';
import { buildAdminServer, loadOrCreateAdminKey } from './admin.js';
import { adminRequestInit } from './adminClient.js';
import { loadOrCreateSecretKey } from './secrets.js';
import { CloudflareTunnel, bindTunnelToConfig } from './tunnel.js';

const USAGE = `InstantLink (MVP, local sharing)

  instantlink serve [--public] [file-or-folder ...]   Start the server; --public opens a Cloudflare tunnel so others can reach your links
  instantlink share <path> [--expires-hours N] [--no-download]   Create a link on a running server
  instantlink list                          List shares
  instantlink link <id>                     Show the link of an active share again
  instantlink revoke <id>                   Turn a link off immediately
`;

async function admin(method: string, route: string, body?: unknown) {
  const cfg = loadConfig();
  const key = (await fsp.readFile(path.join(cfg.dataDir, 'admin-key'), 'utf8').catch(() => '')).trim();
  if (!key) throw new Error('No admin key found. Start the server first: instantlink serve');
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${cfg.adminPort}${route}`, adminRequestInit(method, key, body));
  } catch {
    throw new Error(`Cannot reach InstantLink on port ${cfg.adminPort}. Is "instantlink serve" running?`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(`${data.error}${data.message ? ': ' + data.message : ''}`);
  return data;
}

function printShare(s: Record<string, unknown>) {
  console.log(`\n  ${s.name}  (${s.kind}, id ${s.id})`);
  console.log(`  Link:    ${s.url}`);
  console.log(`  Expires: ${s.expiresAt ? new Date(s.expiresAt as number).toLocaleString() : 'never (until revoked)'}`);
  if (s.publicBaseIsLocal) console.log('  NOTE: this link only works on THIS computer. Set IL_PUBLIC_BASE_URL (tunnel/gateway) so others can open it.');
  const v = s.verification as Record<string, unknown> | undefined;
  if (v) console.log(`  Check:   file available=${v.localFileAvailable}, public route=${v.publicRoute}, video response=${v.videoResponse}, playback=${v.playback}`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'serve') {
    const cfg = loadConfig();
    const store = new ShareStore(path.join(cfg.dataDir, 'shares.json'), loadOrCreateSecretKey(cfg.dataDir));
    const key = loadOrCreateAdminKey(cfg.dataDir);
    const pub = buildPublicServer(store, { logger: true });
    const wantPublic = args.includes('--public');
    const paths = args.filter((a) => a !== '--public');
    // Where to look for cloudflared(.exe) besides IL_CLOUDFLARED_PATH and PATH: the folder you run the command in,
    // the project folder (next to package.json) and the InstantLink data folder.
    const projectRoot = path.resolve(import.meta.dirname, '..');
    const tunnel = new CloudflareTunnel({ localPort: cfg.publicPort, extraDirs: [process.cwd(), projectRoot, cfg.dataDir] });
    bindTunnelToConfig(cfg, tunnel, cfg.publicBaseUrl);
    const adm = buildAdminServer(store, cfg, key, false, tunnel);
    try {
      await pub.listen({ host: cfg.publicHost, port: cfg.publicPort });
      await adm.listen({ host: '127.0.0.1', port: cfg.adminPort });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') console.error(`Port already in use. Set IL_PUBLIC_PORT / IL_ADMIN_PORT to free ports, or close the other program.`);
      else console.error(`Could not start: ${(e as Error).message}`);
      process.exit(1);
    }
    console.log(`InstantLink running. Public server: ${cfg.publicHost}:${cfg.publicPort}  Admin: 127.0.0.1:${cfg.adminPort}`);
    if (!['127.0.0.1', 'localhost', '::1'].includes(cfg.publicHost)) {
      console.warn(`WARNING: IL_PUBLIC_HOST=${cfg.publicHost} lets every device on your Wi-Fi/network open the file server over plain HTTP. The public tunnel does NOT need this. Remove it (PowerShell: Remove-Item Env:IL_PUBLIC_HOST) unless you really want LAN access.`);
    }
    if (wantPublic) {
      console.log('Starting public connection...');
      const t = await tunnel.start();
      if (t.state === 'connected') console.log(`Public address: ${t.url}  (reachability check runs in the background)`);
      else console.error(`Public connection FAILED: ${t.error}\nLinks will only work on this computer.`);
    }
    for (const p of paths) {
      const r = await adm.inject({ method: 'POST', url: '/api/shares', headers: { 'x-admin-key': key, host: `127.0.0.1:${cfg.adminPort}` }, payload: { path: path.resolve(p), verify: true } });
      if (r.statusCode === 201) printShare(r.json());
      else console.error(`Could not share ${p}: ${r.json().message ?? r.json().error}`);
    }
    const stop = async () => { await tunnel.stop(); await pub.close(); await adm.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  if (cmd === 'share' && args[0]) {
    const hours = args.indexOf('--expires-hours');
    const body: Record<string, unknown> = { path: path.resolve(args[0]), verify: true };
    if (hours >= 0) body.expiresInSeconds = Number(args[hours + 1]) * 3600;
    if (args.includes('--no-download')) body.allowDownload = false;
    return printShare(await admin('POST', '/api/shares', body));
  }
  if (cmd === 'list') {
    for (const s of (await admin('GET', '/api/shares')) as Record<string, unknown>[]) console.log(`${s.id}  ${String(s.state).padEnd(8)} ${s.kind}  ${s.name}`);
    return;
  }
  if (cmd === 'link' && args[0]) {
    console.log((await admin('GET', `/api/shares/${args[0]}/link`)).url);
    return;
  }
  if (cmd === 'revoke' && args[0]) {
    await admin('POST', `/api/shares/${args[0]}/revoke`);
    console.log('Link revoked. It stops working immediately.');
    return;
  }
  console.log(USAGE);
}

main().catch((e) => { console.error(`Error: ${(e as Error).message}`); process.exit(1); });
