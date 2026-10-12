// Sandboxed preload: the ONLY bridge between the UI and the main process. No Node APIs are exposed.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { InstantLinkApi } from './api.js';

const api: InstantLinkApi = {
  pickFile: () => ipcRenderer.invoke('il:pickFile'),
  pickFolder: () => ipcRenderer.invoke('il:pickFolder'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  createShare: (req) => ipcRenderer.invoke('il:createShare', req),
  listShares: () => ipcRenderer.invoke('il:listShares'),
  getStatus: () => ipcRenderer.invoke('il:getStatus'),
  getLink: (id) => ipcRenderer.invoke('il:getLink', id),
  copyLink: (id) => ipcRenderer.invoke('il:copyLink', id),
  openLink: (id) => ipcRenderer.invoke('il:openLink', id),
  revokeShare: (id) => ipcRenderer.invoke('il:revokeShare', id),
  setExpiry: (id, expiry) => ipcRenderer.invoke('il:setExpiry', id, expiry),
  startPublic: () => ipcRenderer.invoke('il:startPublic'),
  stopPublic: () => ipcRenderer.invoke('il:stopPublic'),
};

contextBridge.exposeInMainWorld('il', api);
