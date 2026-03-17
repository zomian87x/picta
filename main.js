const { app, BrowserWindow, ipcMain, dialog, nativeTheme, safeStorage, clipboard, nativeImage, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('electron-store');
const { GoogleGenerativeAI } = require('@google/generative-ai');
let autoUpdater = null;

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// ── Gemini ──
const { MODEL_ALIASES, ASPECT_RATIOS, resolveModel, extractImage } = require('./src/lib/models');
const { computeResizeDimensions } = require('./src/lib/image-utils');
const { Logger } = require('./src/lib/logger');

let logger;
let store;
let historyStore;

function initStores() {
  store = new Store({
    name: 'picta-config',
    defaults: {
      theme: 'system',
      language: 'ja',
      modelAlias: 'nanobanana 2',
      imageSlotCount: 2,
      resolution: '2K',
      notificationSound: true,
      notificationSoundType: 'default',
      defaultSavePath: app.getPath('pictures'),
      maxInputLongEdge: 2048,
      promptPresets: {
        '線画（トーンなし）': `画像編集をしてください。与えられた画像をもとに、次のような画像を作ってください。\n\n白い紙に純粋な黒インクの線のみで描かれた漫画の背景イラスト。\n線は綺麗で鮮明。\nパースは元画像から変更しない。\n使用するのは黒インクの線のみ。\nトーン・スクリーントーン・ドットパターン・グレー塗り・グラデーションは使用禁止。\n奥行きを示すために最低限のハッチングのみ使用可。\n背景のみでキャラクターは含まない。\n画像内の文字・テキスト・看板の文字などは全て消去する。\nシャープで印刷可能な品質。`,
        '線画＋トーン': `画像編集をしてください。与えられた画像をもとに、次のような画像を作ってください。\n\n白い紙に黒インクの線画とスクリーントーンによる陰影で描かれた漫画の背景イラスト。\n綺麗で鮮明な輪郭線。\nパースは元画像から変更しない。\n影と奥行きにはスクリーントーンのドットパターンとグラデーショントーンを使用。\nカラーなし、絵画的な陰影なし、フォトリアルな描写なし。\n背景のみでキャラクターは含まない。\n画像内の文字・テキスト・看板の文字などは全て消去する。\nハイコントラストで印刷可能な品質。`,
      },
    },
  });
  historyStore = new Store({
    name: 'picta-history',
    defaults: { entries: [] },
  });
}

let mainWindow;

// Approved save paths from dialog (token -> filePath)
const approvedSavePaths = new Map();

function getApiKey() {
  try {
    const encrypted = store.get('apiKeyEncrypted');
    if (!encrypted) return null;
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  } catch {
    return null;
  }
}

function setApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, reason: 'secure-storage-unavailable' };
  }
  try {
    const encrypted = safeStorage.encryptString(key);
    store.set('apiKeyEncrypted', encrypted.toString('base64'));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'save-failed' };
  }
}

function createWindow() {
  const theme = store.get('theme', 'system');
  if (theme === 'dark') nativeTheme.themeSource = 'dark';
  else if (theme === 'light') nativeTheme.themeSource = 'light';
  else nativeTheme.themeSource = 'system';

  const windowOptions = {
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Picta',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 15, y: 15 };
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Prevent navigation away from the app
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Prevent new windows from opening
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Build application menu
  const menuTemplate = [];

  if (isMac) {
    menuTemplate.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: () => mainWindow.webContents.send('open-settings') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  menuTemplate.push(
    {
      label: 'File',
      submenu: [
        { label: 'Save Image', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('save-image') },
        { type: 'separator' },
        { label: 'Generate', accelerator: 'CmdOrCtrl+Return', click: () => mainWindow.webContents.send('trigger-generate') },
        ...(!isMac ? [
          { type: 'separator' },
          { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: () => mainWindow.webContents.send('open-settings') },
          { type: 'separator' },
          { role: 'quit' },
        ] : []),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Paste Image', accelerator: 'CmdOrCtrl+Shift+V', click: () => mainWindow.webContents.send('paste-image') },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

app.whenReady().then(() => {
  logger = new Logger(path.join(app.getPath('userData'), 'logs'));
  logger.info('App started', { version: app.getVersion(), platform: process.platform });
  initStores();
  createWindow();
  initAutoUpdater();
});

process.on('uncaughtException', (err) => {
  if (logger) logger.error('Uncaught exception', { message: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  if (logger) logger.error('Unhandled rejection', { message: reason?.message, stack: reason?.stack });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC Handlers ──

// Config
ipcMain.handle('get-config', () => {
  return {
    theme: store.get('theme'),
    language: store.get('language'),
    modelAlias: store.get('modelAlias'),
    resolution: store.get('resolution'),
    imageSlotCount: store.get('imageSlotCount'),
    notificationSound: store.get('notificationSound'),
    notificationSoundType: store.get('notificationSoundType'),
    defaultSavePath: store.get('defaultSavePath'),
    maxInputLongEdge: store.get('maxInputLongEdge'),
    promptPresets: store.get('promptPresets'),
    hasApiKey: !!getApiKey(),
  };
});

ipcMain.handle('set-config', (_event, key, value) => {
  if (key === 'theme') {
    nativeTheme.themeSource = value === 'system' ? 'system' : value;
  }
  store.set(key, value);
  return true;
});

// API Key
ipcMain.handle('set-api-key', (_event, key) => {
  return setApiKey(key);
});

// Prompt presets
ipcMain.handle('get-presets', () => store.get('promptPresets'));
ipcMain.handle('save-preset', (_event, name, prompt) => {
  const presets = store.get('promptPresets');
  presets[name] = prompt;
  store.set('promptPresets', presets);
  return presets;
});
ipcMain.handle('delete-preset', (_event, name) => {
  const presets = store.get('promptPresets');
  delete presets[name];
  store.set('promptPresets', presets);
  return presets;
});

// History
ipcMain.handle('get-history', () => historyStore.get('entries'));
ipcMain.handle('add-history', (_event, entry) => {
  const entries = historyStore.get('entries');
  entries.push(entry);
  // Keep last 50
  if (entries.length > 50) entries.splice(0, entries.length - 50);
  historyStore.set('entries', entries);
  return true;
});
ipcMain.handle('clear-history', () => {
  historyStore.set('entries', []);
  return true;
});

ipcMain.handle('toggle-history-favorite', (_event, timestamp) => {
  const entries = historyStore.get('entries');
  const entry = entries.find(e => e.timestamp === timestamp);
  if (entry) {
    entry.favorite = !entry.favorite;
    historyStore.set('entries', entries);
    return entry.favorite;
  }
  return false;
});

// File dialogs
ipcMain.handle('select-save-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Default Save Folder',
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('save-image-dialog', async (_event, defaultName) => {
  const savePath = store.get('defaultSavePath', app.getPath('pictures'));
  // Create date-based subfolder (YYYY-MM-DD)
  const today = new Date().toISOString().slice(0, 10);
  const datePath = path.join(savePath, today);
  if (!fs.existsSync(datePath)) {
    fs.mkdirSync(datePath, { recursive: true });
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(datePath, defaultName || 'picta-output.png'),
    filters: [
      { name: 'PNG', extensions: ['png'] },
      { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
    ],
  });
  if (result.canceled) return null;
  // Store the approved path under a one-time token
  const token = crypto.randomUUID();
  approvedSavePaths.set(token, result.filePath);
  return { token, filePath: result.filePath };
});

ipcMain.handle('save-image-file', async (_event, token, base64Data) => {
  const filePath = approvedSavePaths.get(token);
  if (!filePath) return false;
  approvedSavePaths.delete(token);
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return true;
  } catch (e) {
    return false;
  }
});

// Clipboard
ipcMain.handle('copy-image-to-clipboard', (_event, base64Data) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const img = nativeImage.createFromBuffer(buffer);
    clipboard.writeImage(img);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('get-clipboard-image', () => {
  try {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    return img.toPNG().toString('base64');
  } catch {
    return null;
  }
});

// Theme query
ipcMain.handle('get-native-theme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

nativeTheme.on('updated', () => {
  if (mainWindow) {
    mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  }
});

// ── Gemini Generation ──
ipcMain.handle('generate-image', async (_event, { prompt, aspectRatio, imageSize, modelAlias }) => {
  try {
    const apiKey = getApiKey();
    if (!apiKey) return { image: null, text: 'API key not set' };
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = store.get('models', MODEL_ALIASES);
    const { model: modelId } = resolveModel(modelAlias, models);
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        responseModalities: ['image', 'text'],
        imageConfig: {
          imageSize: imageSize,
          aspectRatio: ASPECT_RATIOS[aspectRatio] || '16:9',
        },
      },
    });
    const result = await model.generateContent(`Generate an image: ${prompt}`);
    return extractImage(result.response);
  } catch (e) {
    if (logger) logger.error('generate-image failed', { message: e.message, stack: e.stack });
    throw e;
  }
});

ipcMain.handle('edit-image', async (_event, { images, prompt, aspectRatio, imageSize, modelAlias }) => {
  try {
    const apiKey = getApiKey();
    if (!apiKey) return { image: null, text: 'API key not set' };
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = store.get('models', MODEL_ALIASES);
    const { model: modelId } = resolveModel(modelAlias, models);
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        responseModalities: ['image', 'text'],
        imageConfig: {
          imageSize: imageSize,
          aspectRatio: ASPECT_RATIOS[aspectRatio] || '16:9',
        },
      },
    });
    const parts = [];
    for (const img of images) {
      parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data: img.base64 } });
    }
    parts.push({ text: `Edit this image: ${prompt}` });
    const result = await model.generateContent(parts);
    return extractImage(result.response);
  } catch (e) {
    if (logger) logger.error('edit-image failed', { message: e.message, stack: e.stack });
    throw e;
  }
});

// Open external link (allowlist: https only)
ipcMain.handle('open-external', (_event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      return shell.openExternal(url);
    }
  } catch { /* invalid URL */ }
  return false;
});

// Renderer error logging
ipcMain.handle('log-error', (_event, message, stack) => {
  if (logger) logger.error(message, { source: 'renderer', stack });
});

ipcMain.handle('get-log-path', () => {
  return path.join(app.getPath('userData'), 'logs', 'picta.log');
});

// Platform info
ipcMain.handle('get-platform', () => process.platform);

// Online check
ipcMain.handle('check-online', () => {
  try {
    const { net } = require('electron');
    return net.isOnline();
  } catch {
    return true; // assume online if net module unavailable
  }
});

// ── Image Resize ──
ipcMain.handle('resize-image', (_event, base64, mimeType, maxLongEdge) => {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const img = nativeImage.createFromBuffer(buffer);
    const { width, height } = img.getSize();
    const { newW, newH, needsResize } = computeResizeDimensions(width, height, maxLongEdge);
    if (!needsResize) {
      return { base64, mimeType, resized: false };
    }
    const resized = img.resize({ width: newW, height: newH, quality: 'best' });
    const outBuffer = mimeType === 'image/jpeg' ? resized.toJPEG(90) : resized.toPNG();
    return { base64: outBuffer.toString('base64'), mimeType, resized: true };
  } catch {
    return { base64, mimeType, resized: false };
  }
});

// ── Auto Updater ──
function initAutoUpdater() {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.log('electron-updater not available:', err.message);
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info.version);
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded');
    }
  });

  autoUpdater.on('error', (err) => {
    // Silently ignore update errors (no network, no release, etc.)
    console.log('Auto-updater error:', err.message);
  });

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return null;
  try {
    const result = await autoUpdater.checkForUpdates();
    return result?.updateInfo?.version || null;
  } catch {
    return null;
  }
});

ipcMain.handle('download-update', () => {
  if (autoUpdater) autoUpdater.downloadUpdate().catch(() => {});
});

ipcMain.handle('install-update', () => {
  if (autoUpdater) autoUpdater.quitAndInstall(false, true);
});
