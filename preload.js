const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),

  // API Key
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),

  // Presets
  getPresets: () => ipcRenderer.invoke('get-presets'),
  savePreset: (name, prompt) => ipcRenderer.invoke('save-preset', name, prompt),
  deletePreset: (name) => ipcRenderer.invoke('delete-preset', name),

  // Models
  getModels: () => ipcRenderer.invoke('get-models'),
  saveModel: (name, modelConfig) => ipcRenderer.invoke('save-model', name, modelConfig),
  deleteModel: (name) => ipcRenderer.invoke('delete-model', name),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  addHistory: (entry) => ipcRenderer.invoke('add-history', entry),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  toggleHistoryFavorite: (timestamp) => ipcRenderer.invoke('toggle-history-favorite', timestamp),
  updateHistoryTags: (timestamp, tags) => ipcRenderer.invoke('update-history-tags', timestamp, tags),
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),

  // File
  selectSavePath: () => ipcRenderer.invoke('select-save-path'),
  saveImageDialog: (defaultName) => ipcRenderer.invoke('save-image-dialog', defaultName),
  saveImageFile: (token, base64Data) => ipcRenderer.invoke('save-image-file', token, base64Data),

  // Auto-save
  autoSaveImage: (params) => ipcRenderer.invoke('auto-save-image', params),

  // Clipboard
  copyImageToClipboard: (base64Data) => ipcRenderer.invoke('copy-image-to-clipboard', base64Data),
  getClipboardImage: () => ipcRenderer.invoke('get-clipboard-image'),

  // Theme
  getNativeTheme: () => ipcRenderer.invoke('get-native-theme'),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_e, theme) => callback(theme)),

  // Menu events
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', () => callback()),
  onSaveImage: (callback) => ipcRenderer.on('save-image', () => callback()),
  onTriggerGenerate: (callback) => ipcRenderer.on('trigger-generate', () => callback()),
  onPasteImage: (callback) => ipcRenderer.on('paste-image', () => callback()),

  // Gemini
  generateImage: (params) => ipcRenderer.invoke('generate-image', params),
  editImage: (params) => ipcRenderer.invoke('edit-image', params),

  // Logging
  logError: (message, stack) => ipcRenderer.invoke('log-error', message, stack),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),

  // External
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Platform
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Online check
  checkOnline: () => ipcRenderer.invoke('check-online'),

  // Image resize
  resizeImage: (base64, mimeType, maxLongEdge) => ipcRenderer.invoke('resize-image', base64, mimeType, maxLongEdge),

  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_e, version) => callback(version)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback()),
});
