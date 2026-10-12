// Tiny static server for previewing the website locally: npm run web  (then open http://localhost:8090)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function headersFromFile() {
  const out = {};
  let inAll = false;
  for (const line of fs.readFileSync(path.join(root, '_headers'), 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ')) { inAll = line.trim() === '/*'; continue; }
    const i = line.indexOf(':');
    if (inAll && i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function startWebServer(port = 8090, host = '127.0.0.1') {
  const base = headersFromFile();
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    let rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    const inside = file === root || file.startsWith(root + path.sep);
    const name = path.basename(file);
    if (req.method !== 'GET' || !inside || name.startsWith('_') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, base).end('Not found');
      return;
    }
    res.writeHead(200, { ...base, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, hits, port: server.address().port })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port } = await startWebServer(Number(process.env.PORT) || 8090);
  console.log(`InstantLink website preview: http://localhost:${port}  (Ctrl+C to stop)`);
}
