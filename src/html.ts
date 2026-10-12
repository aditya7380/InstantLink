export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Strip control characters and path separators so names are safe to display. */
export function safeDisplayName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\\/]/g, '_');
  return cleaned.slice(0, 200) || 'file';
}

export function formatSize(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

export function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

const CSS = `
:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#15181e;--card:#fff;--muted:#5a6270;--accent:#2457d6;--border:#dde1e8}
@media (prefers-color-scheme:dark){:root{--bg:#101318;--fg:#eceef2;--card:#181c23;--muted:#a1a9b6;--accent:#7aa2ff;--border:#2a303b}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:860px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
h1{font-size:1.15rem;margin:0 0 4px;word-break:break-word}
.meta{color:var(--muted);font-size:.9rem;margin:0 0 12px}
video,audio{width:100%;max-height:70vh;background:#000;border-radius:8px}
a.btn{display:inline-block;margin:12px 8px 0 0;padding:10px 16px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
a.btn.alt{background:transparent;color:var(--accent);border:1px solid var(--accent)}
a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
ul{padding-left:20px}li{word-break:break-word;margin:4px 0}
`;

export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

export function errorPage(heading: string, detail: string): string {
  return layout(heading, `<div class="card" role="alert"><h1>${esc(heading)}</h1><p class="meta">${esc(detail)}</p>
<a class="btn alt" href="">Try again</a></div>`);
}
