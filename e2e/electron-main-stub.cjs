// Minimal Electron main used only to get a Chromium with Electron's media codecs.
const { app } = require('electron');
app.on('window-all-closed', () => {});
