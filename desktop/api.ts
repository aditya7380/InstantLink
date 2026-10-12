/** Shapes shared by main, preload and the React UI. */
export type ExpiryChoice = '1h' | '24h' | '7d' | '30d' | 'never';

export interface ShareView {
  id: string; name: string; kind: 'file' | 'folder'; state: 'active' | 'expired' | 'revoked';
  createdAt: number; expiresAt: number | null; allowDownload: boolean; sizeBytes: number | null;
  linkAvailable: boolean; availability: string;
}
export interface Verification {
  localFileAvailable: boolean; publicRoute: 'reachable' | 'unreachable' | 'local_only';
  videoResponse: 'valid' | 'invalid' | 'not_applicable' | 'not_checked'; playback: 'not_tested'; firstByteMs: number | null; notes: string[];
}
export interface CreatedShare extends ShareView { url: string; verification?: Verification }
export interface TunnelStatus {
  state: 'off' | 'starting' | 'connected' | 'failed' | 'disconnected'; url: string | null; error: string | null;
  reachability: 'unchecked' | 'checking' | 'reachable' | 'unreachable'; checkedAt: number | null; note: string;
}
export interface AppStatus { publicBaseUrl: string; publicBaseIsLocal: boolean; tunnel: TunnelStatus | null }

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface InstantLinkApi {
  pickFile(): Promise<Result<string | null>>;
  pickFolder(): Promise<Result<string | null>>;
  pathForFile(file: File): string;
  createShare(req: { path: string; expiry: ExpiryChoice; allowDownload: boolean }): Promise<Result<CreatedShare>>;
  listShares(): Promise<Result<ShareView[]>>;
  getStatus(): Promise<Result<AppStatus>>;
  getLink(id: string): Promise<Result<string>>;
  copyLink(id: string): Promise<Result<true>>;
  openLink(id: string): Promise<Result<true>>;
  revokeShare(id: string): Promise<Result<true>>;
  setExpiry(id: string, expiry: ExpiryChoice): Promise<Result<true>>;
  startPublic(): Promise<Result<TunnelStatus>>;
  stopPublic(): Promise<Result<TunnelStatus>>;
}
