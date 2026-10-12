import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppStatus, CreatedShare, ExpiryChoice, ShareView } from '../api.js';

const EXPIRY_LABELS: Record<ExpiryChoice, string> = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days', never: 'Never (until I turn it off)' };

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}
function fmtSize(n: number | null): string {
  if (n === null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}
function fmtExpiry(s: ShareView): string {
  if (s.state === 'revoked') return 'Turned off';
  if (s.state === 'expired') return 'Expired';
  return s.expiresAt ? `Expires ${new Date(s.expiresAt).toLocaleString()}` : 'No expiry';
}

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [shares, setShares] = useState<ShareView[]>([]);
  const [picked, setPicked] = useState<{ path: string } | null>(null);
  const [expiry, setExpiry] = useState<ExpiryChoice>('24h');
  const [allowDownload, setAllowDownload] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const [st, ls] = await Promise.all([window.il.getStatus(), window.il.listShares()]);
    if (st.ok) setStatus(st.value);
    if (ls.ok) setShares(ls.value);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const fail = (text: string) => setMessage({ kind: 'error', text });
  const info = (text: string) => setMessage({ kind: 'info', text });

  async function pick(kind: 'file' | 'folder') {
    const r = await (kind === 'file' ? window.il.pickFile() : window.il.pickFolder());
    if (!r.ok) return fail(r.error);
    if (r.value) { setPicked({ path: r.value }); setCreated(null); setMessage(null); }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    try {
      const p = window.il.pathForFile(f);
      if (!p) return fail('Could not read that item. Please use the Select buttons instead.');
      setPicked({ path: p }); setCreated(null); setMessage(null);
    } catch {
      fail('Could not read that item. Please use the Select buttons instead.');
    }
  }

  async function create() {
    if (!picked) return fail('Choose a file or folder first.');
    setBusy('Creating link…');
    setMessage(null);
    const r = await window.il.createShare({ path: picked.path, expiry, allowDownload });
    setBusy(null);
    if (!r.ok) return fail(r.error);
    setCreated(r.value);
    info('Link created. It has not been uploaded anywhere: the file stays on this computer.');
    void refresh();
  }

  async function act(label: string, fn: () => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>, done?: string) {
    setBusy(label);
    const r = await fn();
    setBusy(null);
    if (!r.ok) fail(r.error); else if (done) info(done);
    void refresh();
  }

  const tunnel = status?.tunnel ?? null;
  const publicState = (() => {
    if (!tunnel || tunnel.state === 'off') return { cls: 'warn', text: 'Links work on this computer only' };
    if (tunnel.state === 'starting') return { cls: 'warn', text: 'Starting public connection…' };
    if (tunnel.state === 'failed') return { cls: 'bad', text: 'Public connection failed' };
    if (tunnel.state === 'disconnected') return { cls: 'bad', text: 'Public connection dropped' };
    if (tunnel.reachability === 'reachable') return { cls: 'good', text: 'Public address answered (checked from this computer)' };
    if (tunnel.reachability === 'unreachable') return { cls: 'bad', text: 'Public address created but not answering' };
    return { cls: 'warn', text: 'Public address created, checking…' };
  })();

  return (
    <main>
      <header>
        <h1>InstantLink</h1>
        <p className={`pill ${publicState.cls}`} role="status">{publicState.text}</p>
      </header>

      <div aria-live="polite" className="live">
        {busy && <p className="banner info">{busy}</p>}
        {message && <p className={`banner ${message.kind}`} role={message.kind === 'error' ? 'alert' : undefined}>{message.text}</p>}
      </div>

      <section className="card" aria-labelledby="modes">
        <h2 id="modes">How sharing works</h2>
        <div className="modes">
          <div className="mode active">
            <h3>Local Instant Share <span className="tag">in use</span></h3>
            <p>Your file stays on this computer and is <strong>not uploaded</strong>. The link works only while this computer is on, online, and InstantLink is open. Anyone who watches or downloads still uses your internet connection.</p>
          </div>
          <div className="mode disabled" aria-disabled="true">
            <h3>Permanent Cloud Share <span className="tag muted">not available yet</span></h3>
            <p>Would upload a copy to cloud storage so the link keeps working when your computer is off. This costs upload time and storage fees. It has not been built in this version.</p>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="create">
        <h2 id="create">1. Choose what to share</h2>
        <div
          className={`drop ${dragging ? 'drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          role="group"
          aria-label="Drop a file or folder here"
        >
          {picked ? (
            <p className="picked"><strong>{baseName(picked.path)}</strong><br /><span className="muted">{picked.path}</span></p>
          ) : (
            <p>Drag a video, file or folder here</p>
          )}
          <div className="row">
            <button ref={pickerRef} onClick={() => void pick('file')}>Select File</button>
            <button onClick={() => void pick('folder')}>Select Folder</button>
          </div>
        </div>

        <h2>2. Settings</h2>
        <div className="row settings">
          <label>Link expires after
            <select value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}>
              {(Object.keys(EXPIRY_LABELS) as ExpiryChoice[]).map((k) => <option key={k} value={k}>{EXPIRY_LABELS[k]}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} /> Allow download</label>
        </div>
        <p className="muted small">Anyone with the link can open it until it expires or you turn it off. A long random link is hard to guess but is not a password.</p>

        <h2>3. Create the link</h2>
        <button className="primary" disabled={!picked || busy !== null} onClick={() => void create()}>Create Link</button>

        {created && (
          <div className="result" aria-label="New link">
            <p className="linkbox" data-testid="created-link">{created.url}</p>
            <div className="row">
              <button className="primary" onClick={() => void act('Copying…', () => window.il.copyLink(created.id), 'Link copied. Paste it into your form or message.')}>Copy Link</button>
              <button onClick={() => void act('Opening…', () => window.il.openLink(created.id))}>Open Preview</button>
            </div>
            <ul className="checks">
              <li className="ok">Link created</li>
              {created.verification && (
                <>
                  <li className={created.verification.localFileAvailable ? 'ok' : 'no'}>File readable from this computer: {created.verification.localFileAvailable ? 'yes' : 'no'}</li>
                  <li className={created.verification.publicRoute === 'reachable' ? 'ok' : created.verification.publicRoute === 'local_only' ? 'warn' : 'no'}>
                    Reachable by other people: {created.verification.publicRoute === 'reachable' ? 'public address answered (checked from this computer; confirm on a phone)' : created.verification.publicRoute === 'local_only' ? 'NOT yet. This link only works on this computer.' : 'no answer'}
                  </li>
                  <li className={created.verification.videoResponse === 'valid' ? 'ok' : created.verification.videoResponse === 'invalid' ? 'no' : 'neutral'}>
                    Video data: {{ valid: 'served correctly (seeking supported)', invalid: 'response looks wrong', not_applicable: 'not a video/audio file', not_checked: 'not checked' }[created.verification.videoResponse]}
                  </li>
                  <li className="neutral">Playback in a browser: not tested. Some formats (e.g. .mkv, some .mov) may not play in every browser.</li>
                </>
              )}
            </ul>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="public">
        <h2 id="public">Let other people open your links</h2>
        <p>Right now links open <strong>{status?.publicBaseIsLocal === false ? 'through a public address' : 'only on this computer'}</strong>. To let people on other networks open them, start a public connection (uses a free Cloudflare quick tunnel; needs the <code>cloudflared</code> program).</p>
        {tunnel?.url && <p className="linkbox">{tunnel.url}</p>}
        {tunnel?.error && <p className="banner error" role="alert">{tunnel.error}</p>}
        {tunnel?.state === 'connected' && <p className="muted small">{tunnel.note}</p>}
        <div className="row">
          <button disabled={busy !== null || tunnel?.state === 'starting' || tunnel?.state === 'connected'} onClick={() => void act('Starting public connection… this can take up to 30 seconds', () => window.il.startPublic())}>Start public connection</button>
          <button disabled={busy !== null || !tunnel || tunnel.state === 'off'} onClick={() => void act('Stopping…', () => window.il.stopPublic(), 'Public connection stopped. Links work on this computer only.')}>Stop</button>
        </div>
        <p className="muted small">The tunnel address changes every time and stops when this app closes. It has no uptime guarantee.</p>
      </section>

      <section className="card" aria-labelledby="active">
        <h2 id="active">Your links</h2>
        {shares.length === 0 ? <p className="muted">No links yet.</p> : (
          <ul className="shares">
            {shares.map((s) => (
              <li key={s.id} className={`share ${s.state}`}>
                <div className="info">
                  <strong>{s.name}</strong> <span className="tag">{s.kind}</span> <span className={`tag state-${s.state}`}>{s.state === 'active' ? 'Active' : s.state === 'revoked' ? 'Turned off' : 'Expired'}</span>
                  <div className="muted small">{fmtSize(s.sizeBytes)} {fmtSize(s.sizeBytes) && '· '}{fmtExpiry(s)}</div>
                </div>
                <div className="row">
                  {s.state === 'active' && s.linkAvailable && <button onClick={() => void act('Copying…', () => window.il.copyLink(s.id), 'Link copied.')} aria-label={`Copy link for ${s.name}`}>Copy Link</button>}
                  {s.state === 'active' && !s.linkAvailable && <span className="muted small">Link can’t be shown again (created by an older version)</span>}
                  {s.state === 'active' && (
                    <label className="small">Expiry
                      <select defaultValue="" onChange={(e) => { const v = e.target.value as ExpiryChoice; if (v) void act('Updating…', () => window.il.setExpiry(s.id, v), 'Expiry updated.'); e.target.value = ''; }} aria-label={`Change expiry for ${s.name}`}>
                        <option value="">Change…</option>
                        {(Object.keys(EXPIRY_LABELS) as ExpiryChoice[]).map((k) => <option key={k} value={k}>{EXPIRY_LABELS[k]}</option>)}
                      </select>
                    </label>
                  )}
                  {s.state === 'active' && <button className="danger" onClick={() => void act('Turning off…', () => window.il.revokeShare(s.id), 'Link turned off. It stops working immediately.')} aria-label={`Revoke link for ${s.name}`}>Revoke Link</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="muted small">Links work only while this computer is on, online, and InstantLink is open.</footer>
    </main>
  );
}
