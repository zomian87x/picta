const { app, BrowserWindow, ipcMain, dialog, nativeTheme, safeStorage, clipboard, nativeImage, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('electron-store');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const GITHUB_REPO = 'zomian87x/picta';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// ── Gemini ──
const { MODEL_ALIASES, ASPECT_RATIOS, resolveModel, extractImage } = require('./src/lib/models');
const { computeResizeDimensions } = require('./src/lib/image-utils');
const { Logger } = require('./src/lib/logger');
const {
  validateConfigSet,
  validateApiKey,
  validatePresetInput,
  validateDeleteName,
  validateModelInput,
  validateHistoryEntry,
  validateHistoryTagsUpdate,
  validateGenerateRequest,
  validateEditRequest,
  validateSaveImageRequest,
  validateResizeRequest,
  validateAutoSavePayload,
  toSafePathSegment,
} = require('./src/lib/ipc-validation');

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
      autoSaveGenerated: true,
      saveMetadata: true,
      saveSourceImages: false,
      organizeByTag: false,
      models: {
        'nano banana': { model: 'gemini-3-pro-image-preview', thinkingLevel: null },
        'nanobanana 2': { model: 'gemini-3.1-flash-image-preview', thinkingLevel: 'MINIMAL' },
        'nano banana pro': { model: 'gemini-3-pro-image-preview', thinkingLevel: null },
      },
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

function rejectIpc(channel, err, meta = {}) {
  if (logger) {
    logger.warn(`Rejected IPC request: ${channel}`, {
      message: err?.message || String(err),
      ...meta,
    });
  }
}

function sanitizeDefaultFileName(defaultName) {
  const fallback = 'picta-output.png';
  if (typeof defaultName !== 'string' || defaultName.trim() === '') {
    return fallback;
  }
  const baseName = path.basename(defaultName.trim());
  const cleaned = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').slice(0, 120);
  return cleaned || fallback;
}

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

function getMaskedApiKey() {
  const key = getApiKey();
  if (!key || key.length < 8) return null;
  return key.slice(0, 4) + '••••' + key.slice(-4);
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
    windowOptions.trafficLightPosition = { x: 15, y: 12 };
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
  if (isMac && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
  }
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
    models: store.get('models'),
    autoSaveGenerated: store.get('autoSaveGenerated'),
    saveMetadata: store.get('saveMetadata'),
    saveSourceImages: store.get('saveSourceImages'),
    organizeByTag: store.get('organizeByTag'),
    hasApiKey: !!getApiKey(),
  };
});

ipcMain.handle('set-config', (_event, key, value) => {
  try {
    const validated = validateConfigSet(key, value);
    if (validated.key === 'theme') {
      nativeTheme.themeSource = validated.value === 'system' ? 'system' : validated.value;
    }
    store.set(validated.key, validated.value);
    return true;
  } catch (err) {
    rejectIpc('set-config', err, { key });
    return false;
  }
});

// API Key
ipcMain.handle('set-api-key', (_event, key) => {
  try {
    return setApiKey(validateApiKey(key));
  } catch (err) {
    rejectIpc('set-api-key', err);
    return { ok: false, reason: 'save-failed' };
  }
});
ipcMain.handle('get-masked-api-key', () => getMaskedApiKey());

// Prompt presets
ipcMain.handle('get-presets', () => store.get('promptPresets'));
ipcMain.handle('save-preset', (_event, name, prompt) => {
  try {
    const validated = validatePresetInput(name, prompt);
    const presets = { ...store.get('promptPresets') };
    presets[validated.name] = validated.prompt;
    store.set('promptPresets', presets);
    return presets;
  } catch (err) {
    rejectIpc('save-preset', err);
    return store.get('promptPresets');
  }
});
ipcMain.handle('delete-preset', (_event, name) => {
  try {
    const safeName = validateDeleteName(name, 'preset name');
    const presets = { ...store.get('promptPresets') };
    delete presets[safeName];
    store.set('promptPresets', presets);
    return presets;
  } catch (err) {
    rejectIpc('delete-preset', err);
    return store.get('promptPresets');
  }
});

// Models
ipcMain.handle('get-models', () => store.get('models'));

// History
ipcMain.handle('get-history', () => historyStore.get('entries'));
ipcMain.handle('add-history', (_event, entry) => {
  try {
    const validated = validateHistoryEntry(entry);
    const entries = historyStore.get('entries');
    entries.push(validated);
    if (entries.length > 50) entries.splice(0, entries.length - 50);
    historyStore.set('entries', entries);
    return true;
  } catch (err) {
    rejectIpc('add-history', err);
    return false;
  }
});
ipcMain.handle('clear-history', () => {
  historyStore.set('entries', []);
  return true;
});

ipcMain.handle('toggle-history-favorite', (_event, timestamp) => {
  try {
    const safeTimestamp = validateHistoryTagsUpdate(timestamp, []).timestamp;
    const entries = historyStore.get('entries');
    const entry = entries.find(e => e.timestamp === safeTimestamp);
    if (entry) {
      entry.favorite = !entry.favorite;
      historyStore.set('entries', entries);
      return entry.favorite;
    }
    return false;
  } catch (err) {
    rejectIpc('toggle-history-favorite', err);
    return false;
  }
});

ipcMain.handle('update-history-tags', (_event, timestamp, tags) => {
  try {
    const validated = validateHistoryTagsUpdate(timestamp, tags);
    const entries = historyStore.get('entries');
    const entry = entries.find(e => e.timestamp === validated.timestamp);
    if (entry) {
      entry.tags = validated.tags;
      historyStore.set('entries', entries);
      return true;
    }
    return false;
  } catch (err) {
    rejectIpc('update-history-tags', err);
    return false;
  }
});

ipcMain.handle('get-all-tags', () => {
  const entries = historyStore.get('entries');
  const tagSet = new Set();
  for (const e of entries) {
    if (e.tags) e.tags.forEach(t => tagSet.add(t));
  }
  return [...tagSet].sort();
});

// File dialogs
ipcMain.handle('select-save-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Default Save Folder',
  });
  if (!result.canceled && result.filePaths.length > 0) {
    store.set('defaultSavePath', result.filePaths[0]);
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
    defaultPath: path.join(datePath, sanitizeDefaultFileName(defaultName)),
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
  let validated;
  try {
    validated = validateSaveImageRequest(token, base64Data);
  } catch (err) {
    rejectIpc('save-image-file', err);
    return false;
  }
  const filePath = approvedSavePaths.get(validated.token);
  if (!filePath) return false;
  approvedSavePaths.delete(validated.token);
  try {
    const buffer = Buffer.from(validated.base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return true;
  } catch (e) {
    return false;
  }
});

// Auto-save image
ipcMain.handle('auto-save-image', async (_event, { base64, mimeType, metadata, sourceImages }) => {
  try {
    const validated = validateAutoSavePayload({ base64, mimeType, metadata, sourceImages });
    const savePath = store.get('defaultSavePath', app.getPath('pictures'));
    const today = new Date().toISOString().slice(0, 10);

    let folder = path.join(savePath, today);
    if (store.get('organizeByTag') && validated.metadata.tags.length > 0) {
      const safeTagFolder = toSafePathSegment(validated.metadata.tags[0]);
      if (safeTagFolder) {
        folder = path.join(folder, safeTagFolder);
      }
    }
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const timestamp = Date.now();
    const ext = validated.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const fileName = `picta-${timestamp}.${ext}`;
    const filePath = path.join(folder, fileName);

    const buffer = Buffer.from(validated.base64, 'base64');
    fs.writeFileSync(filePath, buffer);

    if (store.get('saveMetadata')) {
      const meta = {
        prompt: validated.metadata.prompt,
        modelAlias: validated.metadata.modelAlias,
        aspectRatio: validated.metadata.aspectRatio,
        resolution: validated.metadata.resolution,
        timestamp: validated.metadata.timestamp,
        tags: validated.metadata.tags,
      };

      if (store.get('saveSourceImages') && validated.sourceImages.length > 0) {
        meta.sourceImages = [];
        for (let i = 0; i < validated.sourceImages.length; i++) {
          const srcName = `picta-${timestamp}-src-${i}.png`;
          const srcPath = path.join(folder, srcName);
          const srcBuffer = Buffer.from(validated.sourceImages[i].base64, 'base64');
          fs.writeFileSync(srcPath, srcBuffer);
          meta.sourceImages.push(srcName);
        }
      }

      const metaPath = filePath + '.json';
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    if (logger) logger.info('Auto-saved image', { filePath });
    return { filePath };
  } catch (e) {
    if (logger) logger.error('auto-save-image failed', { message: e.message, stack: e.stack });
    return { error: e.message };
  }
});

// Clipboard
ipcMain.handle('copy-image-to-clipboard', (_event, base64Data) => {
  try {
    const buffer = Buffer.from(validateSaveImageRequest(crypto.randomUUID(), base64Data).base64Data, 'base64');
    const img = nativeImage.createFromBuffer(buffer);
    clipboard.writeImage(img);
    return true;
  } catch (err) {
    rejectIpc('copy-image-to-clipboard', err);
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
    const validated = validateGenerateRequest({ prompt, aspectRatio, imageSize, modelAlias });
    const apiKey = getApiKey();
    if (!apiKey) return { image: null, text: 'API key not set' };
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = store.get('models', MODEL_ALIASES);
    const { model: modelId } = resolveModel(validated.modelAlias, models);
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        responseModalities: ['image', 'text'],
        imageConfig: {
          imageSize: validated.imageSize,
          aspectRatio: ASPECT_RATIOS[validated.aspectRatio] || '16:9',
        },
      },
    });
    const result = await model.generateContent(`Generate an image: ${validated.prompt}`);
    return extractImage(result.response);
  } catch (e) {
    if (logger) logger.error('generate-image failed', { message: e.message, stack: e.stack });
    return { image: null, text: e.message || 'Invalid request' };
  }
});

ipcMain.handle('edit-image', async (_event, { images, prompt, aspectRatio, imageSize, modelAlias }) => {
  try {
    const validated = validateEditRequest({ images, prompt, aspectRatio, imageSize, modelAlias });
    const apiKey = getApiKey();
    if (!apiKey) return { image: null, text: 'API key not set' };
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = store.get('models', MODEL_ALIASES);
    const { model: modelId } = resolveModel(validated.modelAlias, models);
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        responseModalities: ['image', 'text'],
        imageConfig: {
          imageSize: validated.imageSize,
          aspectRatio: ASPECT_RATIOS[validated.aspectRatio] || '16:9',
        },
      },
    });
    const parts = [];
    for (const img of validated.images) {
      parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data: img.base64 } });
    }
    parts.push({ text: `Edit this image: ${validated.prompt}` });
    const result = await model.generateContent(parts);
    return extractImage(result.response);
  } catch (e) {
    if (logger) logger.error('edit-image failed', { message: e.message, stack: e.stack });
    return { image: null, text: e.message || 'Invalid request' };
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
    const validated = validateResizeRequest(base64, mimeType, maxLongEdge);
    const buffer = Buffer.from(validated.base64, 'base64');
    const img = nativeImage.createFromBuffer(buffer);
    const { width, height } = img.getSize();
    const { newW, newH, needsResize } = computeResizeDimensions(width, height, validated.maxLongEdge);
    if (!needsResize) {
      return { base64: validated.base64, mimeType: validated.mimeType, resized: false };
    }
    const resized = img.resize({ width: newW, height: newH, quality: 'best' });
    const outBuffer = validated.mimeType === 'image/jpeg' ? resized.toJPEG(90) : resized.toPNG();
    return { base64: outBuffer.toString('base64'), mimeType: validated.mimeType, resized: true };
  } catch (err) {
    rejectIpc('resize-image', err);
    return { base64, mimeType, resized: false };
  }
});

// ── Update Check (GitHub Releases) ──
async function checkForUpdateFromGitHub() {
  try {
    const { net } = require('electron');
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
    const response = await net.fetch(url, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const latestVersion = (data.tag_name || '').replace(/^v/, '');
    const currentVersion = app.getVersion();
    if (latestVersion && latestVersion !== currentVersion) {
      return { version: latestVersion, url: data.html_url };
    }
    return null;
  } catch {
    return null;
  }
}

function initAutoUpdater() {
  setTimeout(async () => {
    const update = await checkForUpdateFromGitHub();
    if (update && mainWindow) {
      mainWindow.webContents.send('update-available', update.version, update.url);
    }
  }, 5000);
}

ipcMain.handle('check-for-updates', async () => {
  const update = await checkForUpdateFromGitHub();
  return update ? update.version : null;
});

ipcMain.handle('open-release-page', async (_event, url) => {
  if (typeof url === 'string' && url.startsWith('https://github.com/')) {
    await shell.openExternal(url);
  }
});
