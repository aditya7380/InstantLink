import type { Share } from './store.js';

export interface VerifyReport {
  linkCreated: true;
  localFileAvailable: boolean;
  /** 'local_only' = the URL points at this computer, so we cannot say anyone else can reach it. */
  publicRoute: 'reachable' | 'unreachable' | 'local_only';
  videoResponse: 'valid' | 'invalid' | 'not_applicable' | 'not_checked';
  /** We never claim playback: an HTTP response is not proof a browser can decode the video. */
  playback: 'not_tested';
  firstByteMs: number | null;
  notes: string[];
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Fetch the recipient URL the same way a browser would (a 1-byte Range request)
 * and report what was really observed.
 */
export async function verifyShareUrl(url: string, share: Share, timeoutMs = 10_000): Promise<VerifyReport> {
  const report: VerifyReport = {
    linkCreated: true,
    localFileAvailable: false,
    publicRoute: 'unreachable',
    videoResponse: 'not_checked',
    playback: 'not_tested',
    firstByteMs: null,
    notes: [],
  };
  const u = new URL(url);
  const target = share.kind === 'file' ? `${u.origin}${u.pathname.replace(/\/$/, '')}/file` : url;
  const t0 = performance.now();
  try {
    const res = await fetch(target, {
      headers: share.kind === 'file' ? { Range: 'bytes=0-0' } : {},
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    report.firstByteMs = Math.round(performance.now() - t0);
    await res.arrayBuffer();
    report.localFileAvailable = res.status === 200 || res.status === 206;
    report.publicRoute = isLocalHost(u.hostname) ? 'local_only' : 'reachable';
    if (!report.localFileAvailable) {
      report.notes.push(`The link answered with HTTP ${res.status}, so a recipient would not get the file.`);
    }
    if (share.kind === 'file') {
      const ct = res.headers.get('content-type') ?? '';
      const ok = res.status === 206 && /^bytes 0-0\/\d+$/.test(res.headers.get('content-range') ?? '') && (ct.startsWith('video/') || ct.startsWith('audio/'));
      if (ct.startsWith('video/') || ct.startsWith('audio/')) report.videoResponse = ok ? 'valid' : 'invalid';
      else report.videoResponse = 'not_applicable';
    } else {
      report.videoResponse = 'not_applicable';
    }
    if (report.publicRoute === 'local_only') {
      report.notes.push('This link points to your own computer. Other people cannot open it until you set up a public address (tunnel/gateway).');
    }
  } catch (e) {
    report.notes.push(`Could not reach the link: ${(e as Error).name === 'TimeoutError' ? 'timed out' : 'connection failed'}.`);
  }
  report.notes.push('Playback was not tested in a real browser; a valid response does not guarantee your video format plays everywhere.');
  return report;
}
