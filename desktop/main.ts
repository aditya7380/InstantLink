import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { EXPIRY_CHOICES, isOurLink, startBackend, validateCreateRequest, validateExpiryChoice, validateId, type Backend } from './core.js';
import type { Result } from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_INDEX = path.join(here, '..', '..', 'renderer', 'index.html');
let backend: Backend | null = null;
let win: BrowserWindow | null = null;

function ok<T>(value: T): Result<T> { return { ok: true, value }; }
function bad(error: string): Result<never> { return { ok: false, error }; }

async function api(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<Result<unknown>> {
  if (!backend) return bad('InstantLink is still starting. Please try again in a moment.');
  const r = await backend.call(method, url, payload);
  if (r.status >= 200 && r.status < 300) return ok(r.body);
  const b = r.body as { message?: string; error?: string } | null;
  return bad(b?.message ?? b?.error ?? `Request failed (${r.status})`);
}

/** Reject IPC from anything except our own UI page. */
function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith('file://') && decodeURIComponent(url).includes('/renderer/index.html');
}

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<Result<T>> | Result<T>) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) return bad('Blocked: untrusted sender.');
    try {
      return await fn(...(args as A));
    } catch (err) {
      return bad(err instanceof Error ? err.message : 'Something went wrong.');
    }
  });
}

function registerIpc() {
  handle('il:pickFile', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], title: 'Choose a file to share' });
    return ok(r.canceled || !r.filePaths[0] ? null : r.filePaths[0]);
  });
  handle('il:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Choose a folder to share' });
    return ok(r.canceled || !r.filePaths[0] ? null : r.filePaths[0]);
  });
  handle('il:createShare', async (raw: unknown) => {
    const req = validateCreateRequest(raw);
    const seconds = EXPIRY_CHOICES[req.expiry];
    return api('POST', '/api/shares', { path: req.path, allowDownload: req.allowDownload, verify: true, ...(seconds ? { expiresInSeconds: seconds } : {}) });
  });
  handle('il:listShares', () => api('GET', '/api/shares'));
  handle('il:getStatus', () => api('GET', '/api/status'));
  handle('il:getLink', async (id: unknown) => {
    const r = await api('GET', `/api/shares/${validateId(id)}/link`);
    return r.ok ? ok((r.value as { url: string }).url) : r;
  });
  handle('il:copyLink', async (id: unknown) => {
    const r = await api('GET', `/api/shares/${validateId(id)}/link`);
    if (!r.ok) return r;
    clipboard.writeText((r.value as { url: string }).url); // the token goes straight to the clipboard from here
    return ok(true as const);
  });
  handle('il:openLink', async (id: unknown) => {
    const r = await api('GET', `/api/shares/${validateId(id)}/link`);
    if (!r.ok) return r;
    const url = (r.value as { url: string }).url;
    if (!backend || !isOurLink(url, backend.cfg, backend.localBase)) return bad('Refusing to open an unexpected address.');
    await shell.openExternal(url);
    return ok(true as const);
  });
  handle('il:revokeShare', async (id: unknown) => {
    const r = await api('POST', `/api/shares/${validateId(id)}/revoke`);
    return r.ok ? ok(true as const) : r;
  });
  handle('il:setExpiry', async (id: unknown, choice: unknown) => {
    const seconds = EXPIRY_CHOICES[validateExpiryChoice(choice)];
    const r = await api('POST', `/api/shares/${validateId(id)}/expiry`, { expiresInSeconds: seconds });
    return r.ok ? ok(true as const) : r;
  });
  handle('il:startPublic', () => api('POST', '/api/tunnel/start'));
  handle('il:stopPublic', () => api('POST', '/api/tunnel/stop'));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 760, minWidth: 720, minHeight: 560, title: 'InstantLink',
    show: !process.env.IL_HEADLESS,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false,
    },
  });
  win.removeMenu();
  // The UI never navigates away and never opens windows; external links go through our own validated handler.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadFile(RENDERER_INDEX);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    try {
      backend = await startBackend(path.join(app.getPath('userData'), 'data'), {
        cloudflaredPath: process.env.IL_CLOUDFLARED_PATH,
        // Beginner-friendly: cloudflared.exe is found if it sits next to the app (installed) or in the project folder (source run).
        cloudflaredDirs: [app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(), app.getPath('userData')],
      });
    } catch (e) {
      dialog.showErrorBox('InstantLink could not start', e instanceof Error ? e.message : String(e));
      app.quit();
      return;
    }
    registerIpc();
    await createWindow();
  });
  let closing = false;
  app.on('before-quit', (e) => {
    if (closing || !backend) return;
    e.preventDefault();
    closing = true;
    void backend.close().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
