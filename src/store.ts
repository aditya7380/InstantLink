import fs from 'node:fs';
import path from 'node:path';
import { generateId, generateToken, hashToken } from './tokens.js';
import { decryptText, encryptText } from './secrets.js';
import { renameWithRetry } from './fsutil.js';

export interface Share {
  id: string;
  tokenHash: string;
  /** Raw token encrypted with the local secret key, so the owner can copy the link again. null = not recoverable. */
  tokenEnc: string | null;
  kind: 'file' | 'folder';
  /** Real (symlink-resolved) path of the file or folder. Never sent to recipients. */
  sourcePath: string;
  displayName: string;
  /** Snapshot of the file when the link was created (files only). */
  sizeAtCreate: number | null;
  mtimeMsAtCreate: number | null;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  allowDownload: boolean;
  mode: 'local';
}

export interface NewShare {
  kind: 'file' | 'folder';
  sourcePath: string;
  displayName: string;
  sizeAtCreate: number | null;
  mtimeMsAtCreate: number | null;
  expiresAt: number | null;
  allowDownload: boolean;
}

/** Simple JSON-file store with atomic writes. Behind a class so SQLite can replace it later. */
export class ShareStore {
  private byId = new Map<string, Share>();
  private byHash = new Map<string, Share>();

  constructor(private file: string | null, private key: Buffer | null = null) {
    if (file && fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as { shares: Share[] };
      for (const s of parsed.shares) this.index({ ...s, tokenEnc: s.tokenEnc ?? null }); // older records have no tokenEnc
    }
  }

  private index(s: Share) {
    this.byId.set(s.id, s);
    this.byHash.set(s.tokenHash, s);
  }

  private persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ shares: [...this.byId.values()] }, null, 2), { mode: 0o600 });
    renameWithRetry(tmp, this.file);
  }

  /** Returns the share plus the raw token (shown once; only its hash is stored). */
  create(input: NewShare): { share: Share; token: string } {
    const token = generateToken();
    const share: Share = {
      id: generateId(),
      tokenHash: hashToken(token),
      tokenEnc: this.key ? encryptText(this.key, token) : null,
      ...input,
      createdAt: Date.now(),
      revokedAt: null,
      mode: 'local',
    };
    this.index(share);
    this.persist();
    return { share, token };
  }

  findByToken(token: string): Share | undefined {
    return this.byHash.get(hashToken(token));
  }

  /** Raw token for the owner's "copy link". Only for admin use; null if revoked, unrecoverable or tampered. */
  revealToken(id: string): string | null {
    const s = this.byId.get(id);
    if (!s || !s.tokenEnc || !this.key || s.revokedAt !== null) return null;
    const t = decryptText(this.key, s.tokenEnc);
    return t !== null && hashToken(t) === s.tokenHash ? t : null;
  }

  get(id: string): Share | undefined {
    return this.byId.get(id);
  }

  list(): Share[] {
    return [...this.byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  revoke(id: string): Share | undefined {
    const s = this.byId.get(id);
    if (!s) return undefined;
    if (s.revokedAt === null) {
      s.revokedAt = Date.now();
      this.persist();
    }
    return s;
  }

  setExpiry(id: string, expiresAt: number | null): Share | undefined {
    const s = this.byId.get(id);
    if (!s) return undefined;
    s.expiresAt = expiresAt;
    this.persist();
    return s;
  }
}

export type ShareState = 'active' | 'expired' | 'revoked';

export function shareState(s: Share, now = Date.now()): ShareState {
  if (s.revokedAt !== null) return 'revoked';
  if (s.expiresAt !== null && now >= s.expiresAt) return 'expired';
  return 'active';
}
