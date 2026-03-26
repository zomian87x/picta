/**
 * Picta — Renderer Process
 */

// ── Global Error Handlers ──
window.addEventListener('error', (e) => {
  window.api?.logError(e.message, e.error?.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  window.api?.logError(e.reason?.message || 'Unhandled rejection', e.reason?.stack);
});

// ── State ──
let config = {};
let generatedImages = []; // [{base64, mimeType}]
let imageSlots = []; // [{base64, mimeType, label}]
let isGenerating = false;
let platformIsMac = true;
let isOnline = true;
let canvasUndoStack = [];
let isEraserActive = false;

// ── DOM References ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Init ──
async function init() {
  config = await window.api.getConfig();
  const platform = await window.api.getPlatform();
  platformIsMac = platform === 'darwin';

  // Set language
  setLanguage(config.language || 'ja');

  // Apply theme
  await applyTheme(config.theme);

  // Apply translations to static elements
  applyTranslations();

  // Populate UI from config
  $('#setting-theme').value = config.theme;
  $('#setting-language').value = config.language || 'ja';
  populateModelSelect();
  $('#setting-model').value = config.modelAlias;
  $('#setting-resolution').value = config.resolution || '2K';
  $('#setting-slot-count').value = config.imageSlotCount;
  $('#save-path-display').textContent = config.defaultSavePath;
  updateApiKeyStatus();
  $('#setting-sound-type').value = config.notificationSoundType || 'default';

  if (config.notificationSound) {
    $('#setting-notification-sound').classList.add('active');
  }
  if (config.autoSaveGenerated) {
    $('#setting-auto-save').classList.add('active');
  }
  if (config.saveMetadata) {
    $('#setting-save-metadata').classList.add('active');
  }
  if (config.saveSourceImages) {
    $('#setting-save-source').classList.add('active');
  }
  if (config.organizeByTag) {
    $('#setting-organize-tag').classList.add('active');
  }

  // Update shortcut hints based on OS
  const modKey = platformIsMac ? 'Cmd' : 'Ctrl';
  $('#generate-hint').textContent = t('generate.empty_hint', modKey);

  // Add Windows-specific body class for titlebar padding
  if (!platformIsMac) {
    document.body.classList.add('platform-win');
  }

  // Build image slots
  buildImageSlots(config.imageSlotCount);

  // Load presets
  await loadPresets();

  // Load history
  setupHistoryThumbSize();
  await loadHistory();

  // Setup event listeners
  setupNavigation();
  setupGeneration();
  setupCanvas();
  setupSettings();
  setupPresetModal();
  await loadModels();
  setupKeyboardShortcuts();
  setupMenuEvents();
  setupDragDrop();
  setupAutoUpdate();
  setupOnlineCheck();
  setupMentionAutocomplete();
  setupHistoryModal();
  setupImageLightbox();
  buildShortcutList();
  buildHelpContent();
}

// ── i18n ──
function applyTranslations() {
  // data-i18n: set textContent
  $$('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // data-i18n-placeholder: set placeholder
  $$('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // data-i18n-suffix: append translated suffix to value text (for aspect ratio options)
  $$('[data-i18n-suffix]').forEach(el => {
    const val = el.value;
    const suffix = t(el.dataset.i18nSuffix);
    el.textContent = `${val} (${suffix})`;
  });
  updateGenerateButtonLabel();
}

function updateGenerateButtonLabel() {
  const btn = $('#generate-btn');
  if (isGenerating) return;
  const mod = platformIsMac ? '⌘' : 'Ctrl';
  btn.innerHTML = `${t('generate.button')} <span class="btn-shortcut"><kbd class="kbd">${mod}</kbd>+<kbd class="kbd">Enter</kbd></span>`;
}

// ── Theme ──
async function applyTheme(theme) {
  let effectiveTheme = theme;
  if (theme === 'system') {
    effectiveTheme = await window.api.getNativeTheme();
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme);
}

window.api.onThemeChanged((theme) => {
  if (config.theme === 'system') {
    document.documentElement.setAttribute('data-theme', theme);
  }
});

// ── Navigation ──
function setupNavigation() {
  $$('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('disabled')) return;
      navigateToPanel(btn.dataset.panel);
    });
  });
}

function navigateToPanel(panel) {
  $$('.sidebar-btn').forEach(b => b.classList.remove('active'));
  $(`[data-panel="${panel}"]`).classList.add('active');
  $$('.panel').forEach(p => p.classList.remove('active'));
  $(`#panel-${panel}`).classList.add('active');
}

// ── API Key Status ──
async function updateApiKeyStatus() {
  const masked = await window.api.getMaskedApiKey();
  $('#api-key-status').textContent = masked || t('settings.api_key_status_unset');
}

// ── Online / Offline ──
function setupOnlineCheck() {
  window.addEventListener('online', () => {
    updateOnlineStatus(true);
    showToast(t('toast.back_online'), 'success');
  });
  window.addEventListener('offline', () => {
    updateOnlineStatus(false);
    showToast(t('toast.offline'), 'error');
  });

  // Initial check
  window.api.checkOnline().then(online => updateOnlineStatus(online));
}

function updateOnlineStatus(online) {
  isOnline = online;
  const banner = $('#offline-banner');
  const generateBtn = $('[data-panel="generate"]');
  const canvasBtn = $('[data-panel="canvas"]');

  if (!online) {
    banner.classList.remove('hidden');
    generateBtn.classList.add('disabled');
    canvasBtn.classList.add('disabled');

    // Force to history if on a disabled panel
    const activePanel = $('.panel.active');
    if (activePanel && (activePanel.id === 'panel-generate' || activePanel.id === 'panel-canvas')) {
      navigateToPanel('history');
    }
  } else {
    banner.classList.add('hidden');
    generateBtn.classList.remove('disabled');
    canvasBtn.classList.remove('disabled');
  }
}

// ── Image Slots ──
function buildImageSlots(count) {
  const container = $('#image-slots');
  container.innerHTML = '';
  imageSlots = [];

  for (let i = 0; i < count; i++) {
    imageSlots.push({ base64: null, mimeType: null, label: '' });
    const slot = document.createElement('div');
    slot.className = 'image-slot';
    slot.dataset.index = i;
    slot.innerHTML = `
      <div class="slot-header">
        <input type="text" placeholder="${t('generate.slot_label_placeholder')}" data-label-index="${i}">
      </div>
      <div class="slot-placeholder">${t('generate.slot_placeholder', i + 1)}</div>
      <button class="slot-remove hidden" data-remove-index="${i}">\u00d7</button>
      <input type="file" accept="image/*" class="hidden" data-file-index="${i}">
    `;

    slot.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      slot.querySelector('input[type="file"]').click();
    });

    slot.querySelector('input[type="file"]').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadImageToSlot(i, file);
    });

    slot.querySelector('input[type="text"]').addEventListener('input', (e) => {
      imageSlots[i].label = e.target.value;
    });

    slot.querySelector('.slot-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      clearSlot(i);
    });

    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      slot.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) loadImageToSlot(i, file);
    });

    container.appendChild(slot);
  }
}

function loadImageToSlot(index, file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    const maxLongEdge = config.maxInputLongEdge || 2048;
    const result = await window.api.resizeImage(base64, file.type, maxLongEdge);
    imageSlots[index].base64 = result.base64;
    imageSlots[index].mimeType = result.mimeType;
    updateSlotUI(index);
    if (result.resized) {
      showToast(t('toast.image_resized', maxLongEdge), 'success');
    }
  };
  reader.readAsDataURL(file);
}

function updateSlotUI(index) {
  const slot = $(`.image-slot[data-index="${index}"]`);
  if (!slot) return;
  const data = imageSlots[index];
  const placeholder = slot.querySelector('.slot-placeholder');
  const removeBtn = slot.querySelector('.slot-remove');

  if (data.base64) {
    slot.classList.add('has-image');
    placeholder.innerHTML = `<img src="data:${data.mimeType};base64,${data.base64}" alt="Slot ${index + 1}">`;
    removeBtn.classList.remove('hidden');
  } else {
    slot.classList.remove('has-image');
    placeholder.innerHTML = t('generate.slot_placeholder', index + 1);
    removeBtn.classList.add('hidden');
  }
}

function clearSlot(index) {
  imageSlots[index] = { base64: null, mimeType: null, label: imageSlots[index].label };
  updateSlotUI(index);
}

// ── @ Mention Autocomplete ──
function setupMentionAutocomplete() {
  const textarea = $('#prompt-input');
  const dropdown = $('#mention-dropdown');
  let activeIndex = -1;

  textarea.addEventListener('input', () => {
    const cursorPos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPos);
    const match = textBefore.match(/@([^\s@]*)$/);

    if (!match) {
      dropdown.classList.add('hidden');
      return;
    }

    const query = match[1].toLowerCase();
    const labeledSlots = imageSlots
      .map((s, i) => ({ label: s.label, index: i, hasImage: !!s.base64 }))
      .filter(s => s.label && s.label.toLowerCase().includes(query));

    if (labeledSlots.length === 0) {
      dropdown.innerHTML = `<div class="mention-item mention-empty">${t('mention.no_labels')}</div>`;
      dropdown.classList.remove('hidden');
      activeIndex = -1;
      return;
    }

    dropdown.innerHTML = '';
    activeIndex = 0;
    labeledSlots.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'mention-item' + (i === 0 ? ' active' : '');
      item.textContent = `@${s.label}`;
      if (s.hasImage) {
        item.innerHTML += ' <span class="mention-badge">📎</span>';
      }
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertMention(s.label, match.index, cursorPos);
      });
      dropdown.appendChild(item);
    });
    dropdown.classList.remove('hidden');
  });

  textarea.addEventListener('keydown', (e) => {
    if (dropdown.classList.contains('hidden')) return;
    const items = dropdown.querySelectorAll('.mention-item:not(.mention-empty)');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      if (activeIndex >= 0 && activeIndex < items.length) {
        e.preventDefault();
        const label = items[activeIndex].textContent.replace(/\s*📎$/, '').replace(/^@/, '');
        const cursorPos = textarea.selectionStart;
        const textBefore = textarea.value.substring(0, cursorPos);
        const matchResult = textBefore.match(/@([^\s@]*)$/);
        if (matchResult) {
          insertMention(label, matchResult.index, cursorPos);
        }
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });

  textarea.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.add('hidden'), 150);
  });
}

function insertMention(label, matchStart, cursorPos) {
  const textarea = $('#prompt-input');
  const dropdown = $('#mention-dropdown');
  const before = textarea.value.substring(0, matchStart);
  const after = textarea.value.substring(cursorPos);
  const mention = `@${label} `;
  textarea.value = before + mention + after;
  textarea.selectionStart = textarea.selectionEnd = matchStart + mention.length;
  textarea.focus();
  dropdown.classList.add('hidden');
}

// transformMentionsForApi is provided by lib/renderer-utils.js
function transformMentionsForApiLocal(prompt) {
  return transformMentionsForApi(prompt, imageSlots, getLanguage());
}

// ── Generation ──
function setupGeneration() {
  $('#generate-btn').addEventListener('click', handleGenerate);
}

async function handleGenerate() {
  if (isGenerating) return;
  if (!config.hasApiKey) {
    showToast(t('toast.api_key_required'), 'error');
    return;
  }

  if (!isOnline) {
    showToast(t('toast.no_internet'), 'error');
    return;
  }

  const rawPrompt = $('#prompt-input').value.trim();
  if (!rawPrompt) {
    showToast(t('toast.prompt_required'), 'error');
    return;
  }

  const prompt = transformMentionsForApiLocal(rawPrompt);
  const modelAlias = config.modelAlias;
  const count = parseInt($('#count-select').value);
  const aspectRatio = $('#aspect-select').value;
  const resolution = config.resolution || '2K';

  // Collect input images
  const inputImages = [];
  for (const slot of imageSlots) {
    if (slot.base64) {
      inputImages.push({ base64: slot.base64, mimeType: slot.mimeType || 'image/png' });
    }
  }

  if (inputImages.length > 3) {
    showToast(t('toast.max_images'), 'error');
    return;
  }

  isGenerating = true;
  const btn = $('#generate-btn');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${t('generate.generating')}`;

  $('#output-empty').classList.add('hidden');
  const gallery = $('#output-gallery');
  gallery.classList.remove('hidden');
  gallery.innerHTML = '';
  $('#generation-log').classList.remove('hidden');
  $('#generation-log').textContent = t('log.start', modelAlias, inputImages.length);

  const isEdit = inputImages.length > 0;
  const operation = isEdit ? t('log.operation_edit') : t('log.operation_generate');
  generatedImages = new Array(count).fill(null);

  // Create placeholder slots with loading spinners
  for (let i = 0; i < count; i++) {
    const item = document.createElement('div');
    item.className = 'gallery-item gallery-item--loading';
    item.dataset.index = i;
    item.innerHTML = `
      <div class="gallery-placeholder">
        <span class="spinner"></span>
        <span class="gallery-placeholder-label">${i + 1} / ${count}</span>
      </div>
    `;
    gallery.appendChild(item);
  }
  bindGalleryEvents();

  try {
    const STAGGER_DELAY_MS = 200;
    const logEl = $('#generation-log');

    // Launch all requests in parallel with staggered starts to avoid rate limits
    const promises = Array.from({ length: count }, (_, i) => {
      return new Promise(resolve => setTimeout(resolve, i * STAGGER_DELAY_MS))
        .then(() => {
          logEl.textContent += t('log.generating_n', i + 1, count);
          if (isEdit) {
            return window.api.editImage({ images: inputImages, prompt, aspectRatio, imageSize: resolution, modelAlias });
          } else {
            return window.api.generateImage({ prompt, aspectRatio, imageSize: resolution, modelAlias });
          }
        })
        .then(result => {
          const slot = gallery.querySelector(`.gallery-item[data-index="${i}"]`);
          if (result.image) {
            generatedImages[i] = result.image;
            logEl.textContent += ` [${i + 1}]\u2713`;
            if (slot) {
              slot.classList.remove('gallery-item--loading');
              slot.innerHTML = `
                <img src="data:${result.image.mimeType};base64,${result.image.base64}" alt="Generated ${i + 1}">
                <div class="gallery-actions">
                  <button data-action="copy" data-index="${i}" title="${t('toast.copied')}">📋</button>
                  <button data-action="save" data-index="${i}" title="${t('toast.saved', '')}">💾</button>
                </div>
              `;
            }
          } else {
            logEl.textContent += ` [${i + 1}]\u2717 ${result.text || 'Failed'}`;
            if (slot) {
              slot.classList.remove('gallery-item--loading');
              slot.classList.add('gallery-item--error');
              slot.innerHTML = `<div class="gallery-placeholder"><span class="gallery-placeholder-label">\u2717 ${result.text || 'Failed'}</span></div>`;
            }
          }
        });
    });

    await Promise.all(promises);

    // Filter out nulls (failed generations)
    generatedImages = generatedImages.filter(Boolean);

    logEl.textContent += t('log.complete', operation, generatedImages.length, count);

    if (generatedImages.length > 0) {
      // Auto-save first (before heavy loadHistory) to avoid being blocked
      if (config.autoSaveGenerated) {
        for (const img of generatedImages) {
          try {
            const sourceImgs = config.saveSourceImages ? inputImages : [];
            const result = await window.api.autoSaveImage({
              base64: img.base64,
              mimeType: img.mimeType || 'image/png',
              metadata: {
                prompt: rawPrompt,
                modelAlias,
                aspectRatio,
                resolution,
                timestamp: new Date().toISOString(),
                tags: [],
              },
              sourceImages: sourceImgs,
            });
            if (result.filePath) {
              showToast(t('toast.auto_saved', result.filePath), 'success');
            } else if (result.error) {
              showToast(t('toast.save_failed') + ': ' + result.error, 'error');
            }
          } catch (saveErr) {
            showToast(t('toast.save_failed') + ': ' + saveErr.message, 'error');
          }
        }
      }

      // Add history entries and reload
      const baseTimestamp = Date.now();
      for (let hi = 0; hi < generatedImages.length; hi++) {
        const entry = {
          timestamp: new Date(baseTimestamp + hi).toISOString(),
          prompt: rawPrompt,
          modelAlias,
          operation,
          aspectRatio,
          resolution,
          imageCount: 1,
          thumbnail: generatedImages[hi].base64.substring(0, 2000),
          thumbnailFull: generatedImages[hi].base64,
        };
        await window.api.addHistory(entry);
      }
      await loadHistory();

      playNotificationSound();
    }
  } catch (e) {
    $('#generation-log').textContent += `\n\nError: ${e.message}`;
    showToast(t('toast.generation_failed', e.message), 'error');
  } finally {
    isGenerating = false;
    btn.disabled = false;
    updateGenerateButtonLabel();
  }
}

let selectedImageIndex = -1;

let galleryListenerBound = false;

function bindGalleryEvents() {
  const gallery = $('#output-gallery');
  if (galleryListenerBound) return;
  galleryListenerBound = true;

  gallery.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      const idx = parseInt(btn.dataset.index);
      const img = generatedImages[idx];
      if (!img) return;

      if (btn.dataset.action === 'copy') {
        const ok = await window.api.copyImageToClipboard(img.base64);
        showToast(ok ? t('toast.copied') : t('toast.copy_failed'), ok ? 'success' : 'error');
      } else if (btn.dataset.action === 'save') {
        await saveImage(img.base64, `picta-${Date.now()}.png`);
      }
      return;
    }

    // Click on gallery item to select + open lightbox
    const item = e.target.closest('.gallery-item');
    if (item) {
      const idx = parseInt(item.dataset.index);
      gallery.querySelectorAll('.gallery-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      selectedImageIndex = idx;

      const img = item.querySelector('img');
      if (img) {
        $('#lightbox-img').src = img.src;
        $('#image-lightbox').classList.remove('hidden');
      }
    }
  });
}

function renderGallery() {
  const gallery = $('#output-gallery');
  gallery.innerHTML = '';

  for (let i = 0; i < generatedImages.length; i++) {
    const img = generatedImages[i];
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.dataset.index = i;
    item.innerHTML = `
      <img src="data:${img.mimeType};base64,${img.base64}" alt="Generated ${i + 1}">
      <div class="gallery-actions">
        <button data-action="copy" data-index="${i}" title="${t('toast.copied')}">📋</button>
        <button data-action="save" data-index="${i}" title="${t('toast.saved', '')}">💾</button>
      </div>
    `;
    gallery.appendChild(item);
  }

  bindGalleryEvents();
}

async function saveImage(base64, defaultName) {
  const result = await window.api.saveImageDialog(defaultName);
  if (result) {
    const ok = await window.api.saveImageFile(result.token, base64);
    showToast(ok ? t('toast.saved', result.filePath) : t('toast.save_failed'), ok ? 'success' : 'error');
  }
}

// ── Canvas ──
let drawCtx = null;
let isDrawing = false;
const MAX_UNDO = 15;

function setupCanvas() {
  const canvas = $('#draw-canvas');
  drawCtx = canvas.getContext('2d');
  drawCtx.fillStyle = '#fff';
  drawCtx.fillRect(0, 0, canvas.width, canvas.height);
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  // Save initial state
  pushCanvasUndo();

  // Convert CSS pixel coords to canvas internal coords
  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: e.offsetX * scaleX, y: e.offsetY * scaleY };
  }

  // Drawing
  canvas.addEventListener('mousedown', (e) => {
    pushCanvasUndo();
    isDrawing = true;
    const { x, y } = canvasCoords(e);
    drawCtx.beginPath();
    drawCtx.moveTo(x, y);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const { x, y } = canvasCoords(e);
    drawCtx.lineWidth = parseInt($('#brush-size').value);
    if (isEraserActive) {
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.strokeStyle = $('#brush-color').value;
    }
    drawCtx.lineTo(x, y);
    drawCtx.stroke();
  });
  canvas.addEventListener('mouseup', () => { isDrawing = false; });
  canvas.addEventListener('mouseleave', () => { isDrawing = false; });

  // Clear
  $('#canvas-clear').addEventListener('click', () => {
    pushCanvasUndo();
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.fillStyle = '#fff';
    drawCtx.fillRect(0, 0, canvas.width, canvas.height);
    showToast(t('toast.canvas_cleared'), 'success');
  });

  // Apply aspect ratio
  $('#canvas-apply-aspect').addEventListener('click', () => {
    const aspect = $('#aspect-select').value;
    const res = config.resolution || '2K';
    const dims = computeCanvasDims(aspect, res);
    canvas.width = dims.w;
    canvas.height = dims.h;
    drawCtx.fillStyle = '#fff';
    drawCtx.fillRect(0, 0, canvas.width, canvas.height);
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    canvasUndoStack = [];
    pushCanvasUndo();
    showToast(t('toast.canvas_size', dims.w, dims.h), 'success');
  });

  // Use as input — show slot picker
  $('#canvas-use').addEventListener('click', () => {
    showCanvasSlotPicker();
  });

  // Eraser toggle
  $('#canvas-eraser').addEventListener('click', () => {
    isEraserActive = !isEraserActive;
    $('#canvas-eraser').classList.toggle('active', isEraserActive);
  });

  // Undo
  $('#canvas-undo').addEventListener('click', () => {
    if (canvasUndoStack.length <= 1) {
      showToast(t('toast.canvas_no_undo'), 'error');
      return;
    }
    canvasUndoStack.pop(); // remove current state
    const prev = canvasUndoStack[canvasUndoStack.length - 1];
    const img = new Image();
    img.onload = () => {
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.clearRect(0, 0, canvas.width, canvas.height);
      drawCtx.drawImage(img, 0, 0);
    };
    img.src = prev;
    showToast(t('toast.canvas_undo'), 'success');
  });

  // Load image from file
  $('#canvas-load-file').addEventListener('click', () => {
    $('#canvas-file-input').click();
  });
  $('#canvas-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      loadImageToCanvas(ev.target.result);
      showToast(t('toast.canvas_loaded_file'), 'success');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // Load image from slot
  $('#canvas-load-slot').addEventListener('click', () => {
    showCanvasLoadSlotPicker();
  });
}

function pushCanvasUndo() {
  const canvas = $('#draw-canvas');
  canvasUndoStack.push(canvas.toDataURL('image/png'));
  if (canvasUndoStack.length > MAX_UNDO) {
    canvasUndoStack.shift();
  }
}

function loadImageToCanvas(dataUrl) {
  const canvas = $('#draw-canvas');
  const img = new Image();
  img.onload = () => {
    pushCanvasUndo();
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.fillStyle = '#fff';
    drawCtx.fillRect(0, 0, canvas.width, canvas.height);
    // Fit image within canvas preserving aspect ratio
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;
    drawCtx.drawImage(img, x, y, w, h);
  };
  img.src = dataUrl;
}

function showCanvasSlotPicker() {
  const picker = $('#canvas-slot-picker');
  picker.innerHTML = '';

  // Options for each slot
  imageSlots.forEach((slot, i) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary slot-picker-item';
    const label = slot.label ? ` (${slot.label})` : '';
    btn.textContent = `${t('canvas.slot_n', i + 1)}${label}`;
    if (slot.base64) btn.classList.add('has-image');
    btn.addEventListener('click', () => {
      applyCanvasToSlot(i);
    });
    picker.appendChild(btn);
  });

  picker.classList.remove('hidden');
  // Close on outside click
  const close = (e) => {
    if (!picker.contains(e.target) && e.target !== $('#canvas-use')) {
      picker.classList.add('hidden');
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function applyCanvasToSlot(index) {
  const picker = $('#canvas-slot-picker');
  const slot = imageSlots[index];

  function doApply() {
    const base64 = $('#draw-canvas').toDataURL('image/png').split(',')[1];
    slot.base64 = base64;
    slot.mimeType = 'image/png';
    updateSlotUI(index);
    showToast(t('toast.canvas_to_slot', index + 1), 'success');
    picker.classList.add('hidden');
  }

  // Confirm if slot already has an image
  if (slot.base64) {
    showConfirmDialog(
      t('canvas.confirm_overwrite_title'),
      t('canvas.confirm_overwrite', index + 1),
      doApply
    );
  } else {
    doApply();
  }
}

function showCanvasLoadSlotPicker() {
  const picker = $('#canvas-slot-picker');
  picker.innerHTML = '';

  const slotsWithImages = imageSlots
    .map((s, i) => ({ ...s, index: i }))
    .filter(s => s.base64);

  if (slotsWithImages.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'slot-picker-empty';
    msg.textContent = t('canvas.no_slot_images');
    picker.appendChild(msg);
    picker.classList.remove('hidden');
    setTimeout(() => picker.classList.add('hidden'), 2000);
    return;
  }

  slotsWithImages.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary slot-picker-item';
    btn.textContent = `${t('canvas.select_slot')} ${s.index + 1}${s.label ? ` (${s.label})` : ''}`;
    btn.addEventListener('click', () => {
      const dataUrl = `data:${s.mimeType};base64,${s.base64}`;
      loadImageToCanvas(dataUrl);
      showToast(t('toast.canvas_loaded_slot', s.index + 1), 'success');
      picker.classList.add('hidden');
    });
    picker.appendChild(btn);
  });

  picker.classList.remove('hidden');
  const close = (e) => {
    if (!picker.contains(e.target) && e.target !== $('#canvas-load-slot')) {
      picker.classList.add('hidden');
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

// computeCanvasDims is provided by lib/renderer-utils.js

// ── History ──
let historyEntries = [];
let showFavoritesOnly = false;
let activeTagFilter = null;

async function loadHistory() {
  historyEntries = await window.api.getHistory();
  renderTagFilter();
  renderHistoryGrid();
}

const collapsedDates = new Set();

function setupHistoryThumbSize() {
  const slider = $('#history-thumb-size');
  const saved = localStorage.getItem('historyThumbColumns');
  if (saved) slider.value = Math.max(4, Math.min(12, saved));
  applyHistoryThumbSize(slider.value);
  slider.addEventListener('input', (e) => {
    applyHistoryThumbSize(e.target.value);
    localStorage.setItem('historyThumbColumns', e.target.value);
  });
}

function applyHistoryThumbSize(columns) {
  const grid = $('#history-grid');
  // columns=6 → large thumbs, columns=12 → small thumbs
  // Calculate minmax value: divide a reference width by column count
  const minWidth = Math.round(1200 / columns);
  grid.style.setProperty('--history-thumb-size', `${minWidth}px`);
}

function renderHistoryGrid() {
  const grid = $('#history-grid');
  const empty = $('#history-empty');

  // Remove old sections and cards but keep empty state element
  grid.querySelectorAll('.history-date-section').forEach(s => s.remove());

  let filtered = showFavoritesOnly
    ? historyEntries.filter(e => e.favorite)
    : [...historyEntries];
  if (activeTagFilter) {
    filtered = filtered.filter(e => e.tags && e.tags.includes(activeTagFilter));
  }

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  // Group by date (newest first)
  const grouped = new Map();
  for (const entry of filtered.slice().reverse()) {
    const dateKey = new Date(entry.timestamp).toLocaleDateString('ja-JP', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey).push(entry);
  }

  for (const [dateKey, entries] of grouped) {
    const collapsed = collapsedDates.has(dateKey);
    const section = document.createElement('div');
    section.className = 'history-date-section';

    const header = document.createElement('button');
    header.className = `history-date-header${collapsed ? ' collapsed' : ''}`;
    header.innerHTML = `<span class="history-date-chevron">\u25BC</span> ${dateKey} <span class="history-date-count">(${entries.length})</span>`;
    header.addEventListener('click', () => {
      if (collapsedDates.has(dateKey)) {
        collapsedDates.delete(dateKey);
      } else {
        collapsedDates.add(dateKey);
      }
      renderHistoryGrid();
    });
    section.appendChild(header);

    if (!collapsed) {
      const dateGrid = document.createElement('div');
      dateGrid.className = 'history-date-grid';

      for (const entry of entries) {
        const card = document.createElement('div');
        card.className = 'history-card';
        const thumbSrc = entry.thumbnailFull
          ? `data:image/png;base64,${entry.thumbnailFull}`
          : '';

        card.innerHTML = `
          ${thumbSrc ? `<img src="${thumbSrc}" alt="History">` : '<div style="aspect-ratio:16/9;background:var(--bg-tertiary)"></div>'}
          <div class="history-card-meta">
            <div class="history-card-top">
              <span class="timestamp">${new Date(entry.timestamp).toLocaleTimeString('ja-JP')}</span>
              <button class="history-fav-btn ${entry.favorite ? 'active' : ''}" data-timestamp="${entry.timestamp}" title="${t('history.favorite')}">
                ${entry.favorite ? '★' : '☆'}
              </button>
            </div>
            <div class="prompt-preview">${escapeHtml(entry.prompt)}</div>
            <span class="model-badge">${escapeHtml(entry.modelAlias)}</span>
            ${entry.tags && entry.tags.length > 0 ? `<div class="tag-badges">${entry.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          </div>
        `;

        card.querySelector('.history-fav-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const newState = await window.api.toggleHistoryFavorite(entry.timestamp);
          entry.favorite = newState;
          renderHistoryGrid();
        });

        card.addEventListener('click', () => openHistoryDetail(entry));
        dateGrid.appendChild(card);
      }

      section.appendChild(dateGrid);
    }

    grid.appendChild(section);
  }
}

function renderTagFilter() {
  const container = $('#history-tag-filter');
  if (!container) return;
  container.innerHTML = '';

  // Collect all tags
  const tagSet = new Set();
  for (const e of historyEntries) {
    if (e.tags) e.tags.forEach(t => tagSet.add(t));
  }
  if (tagSet.size === 0) return;

  // "All" chip
  const allChip = document.createElement('span');
  allChip.className = `tag-chip ${!activeTagFilter ? 'active' : ''}`;
  allChip.textContent = t('history.all_tags');
  allChip.addEventListener('click', () => {
    activeTagFilter = null;
    renderTagFilter();
    renderHistoryGrid();
  });
  container.appendChild(allChip);

  for (const tag of [...tagSet].sort()) {
    const chip = document.createElement('span');
    chip.className = `tag-chip ${activeTagFilter === tag ? 'active' : ''}`;
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      activeTagFilter = activeTagFilter === tag ? null : tag;
      renderTagFilter();
      renderHistoryGrid();
    });
    container.appendChild(chip);
  }
}

function renderTagEditor(entry) {
  const chips = $('#tag-chips');
  chips.innerHTML = '';
  const tags = entry.tags || [];
  for (const tag of tags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(tag)} <span class="tag-remove">&times;</span>`;
    chip.querySelector('.tag-remove').addEventListener('click', async () => {
      entry.tags = entry.tags.filter(t => t !== tag);
      await window.api.updateHistoryTags(entry.timestamp, entry.tags);
      renderTagEditor(entry);
      renderTagFilter();
      renderHistoryGrid();
    });
    chips.appendChild(chip);
  }

  const input = $('#tag-input');
  // Replace to clear old listeners
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  newInput.value = '';
  newInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = newInput.value.trim().replace(/,/g, '');
      if (!val) return;
      if (!entry.tags) entry.tags = [];
      if (!entry.tags.includes(val)) {
        entry.tags.push(val);
        await window.api.updateHistoryTags(entry.timestamp, entry.tags);
        renderTagEditor(entry);
        renderTagFilter();
        renderHistoryGrid();
      }
      newInput.value = '';
    }
  });
}

// Favorites filter toggle
$('#history-filter-favorites')?.addEventListener('click', () => {
  showFavoritesOnly = !showFavoritesOnly;
  const btn = $('#history-filter-favorites');
  btn.classList.toggle('active', showFavoritesOnly);
  renderHistoryGrid();
});

$('#history-clear')?.addEventListener('click', async () => {
  await window.api.clearHistory();
  await loadHistory();
  showToast(t('toast.history_cleared'), 'success');
});

// ── History Detail Modal ──
function setupHistoryModal() {
  $('#history-detail-close').addEventListener('click', closeHistoryModal);
  $('#history-modal').addEventListener('click', (e) => {
    if (e.target === $('#history-modal')) closeHistoryModal();
  });

  $('#history-detail-fav').addEventListener('click', async () => {
    if (!currentDetailEntry) return;
    const newState = await window.api.toggleHistoryFavorite(currentDetailEntry.timestamp);
    currentDetailEntry.favorite = newState;
    updateDetailFavButton(currentDetailEntry);
    renderHistoryGrid();
  });

  $('#history-reuse-prompt').addEventListener('click', () => {
    const prompt = $('#history-detail-prompt').dataset.prompt;
    if (prompt) {
      $('#prompt-input').value = prompt;
      navigateToPanel('generate');
      closeHistoryModal();
      showToast(t('toast.prompt_reused'), 'success');
    }
  });

  $('#history-load-to-slot').addEventListener('click', () => {
    const base64 = $('#history-detail-img').dataset.base64;
    if (!base64) return;
    const idx = imageSlots.findIndex(s => !s.base64);
    if (idx >= 0) {
      imageSlots[idx].base64 = base64;
      imageSlots[idx].mimeType = 'image/png';
      updateSlotUI(idx);
      navigateToPanel('generate');
      closeHistoryModal();
      showToast(t('toast.image_loaded_slot', idx + 1), 'success');
    } else {
      showToast(t('toast.slots_full'), 'error');
    }
  });

  $('#history-copy-clipboard').addEventListener('click', async () => {
    const base64 = $('#history-detail-img').dataset.base64;
    if (!base64) return;
    const ok = await window.api.copyImageToClipboard(base64);
    showToast(ok ? t('toast.copied') : t('toast.copy_failed'), ok ? 'success' : 'error');
  });
}

let currentDetailEntry = null;

function openHistoryDetail(entry) {
  currentDetailEntry = entry;
  const modal = $('#history-modal');
  const img = $('#history-detail-img');
  const meta = $('#history-detail-meta');
  const promptEl = $('#history-detail-prompt');

  if (entry.thumbnailFull) {
    img.src = `data:image/png;base64,${entry.thumbnailFull}`;
    img.dataset.base64 = entry.thumbnailFull;
  } else {
    img.src = '';
    img.dataset.base64 = '';
  }

  meta.innerHTML = `
    <div><strong>${t('history.model')}:</strong> ${escapeHtml(entry.modelAlias)}</div>
    <div><strong>${t('history.date')}:</strong> ${new Date(entry.timestamp).toLocaleString('ja-JP')}</div>
    <div><strong>${t('history.aspect_ratio')}:</strong> ${escapeHtml(entry.aspectRatio || '-')}</div>
    <div><strong>${t('history.resolution')}:</strong> ${escapeHtml(entry.resolution || '-')}</div>
    <div><strong>${t('history.images_count')}:</strong> ${entry.imageCount || 1}</div>
  `;

  promptEl.textContent = entry.prompt;
  promptEl.dataset.prompt = entry.prompt;

  // Render tag editor
  renderTagEditor(entry);

  // Update favorite button state
  updateDetailFavButton(entry);

  modal.classList.remove('hidden');
}

function updateDetailFavButton(entry) {
  const favBtn = $('#history-detail-fav');
  favBtn.textContent = entry.favorite
    ? `★ ${t('history.unfavorite')}`
    : `☆ ${t('history.favorite')}`;
  favBtn.classList.toggle('active', !!entry.favorite);
}

function closeHistoryModal() {
  $('#history-modal').classList.add('hidden');
}

// ── Settings ──
function setupSettings() {
  // Theme
  $('#setting-theme').addEventListener('change', async (e) => {
    config.theme = e.target.value;
    await window.api.setConfig('theme', e.target.value);
    await applyTheme(e.target.value);
  });

  // Language
  $('#setting-language').addEventListener('change', async (e) => {
    config.language = e.target.value;
    await window.api.setConfig('language', e.target.value);
    setLanguage(e.target.value);
    applyTranslations();
    // Re-render dynamic content
    buildImageSlots(config.imageSlotCount);
    updateApiKeyStatus();
    const modKey = platformIsMac ? 'Cmd' : 'Ctrl';
    $('#generate-hint').textContent = t('generate.empty_hint', modKey);
    buildShortcutList();
    buildHelpContent();
  });

  // Model
  $('#setting-model').addEventListener('change', async (e) => {
    config.modelAlias = e.target.value;
    await window.api.setConfig('modelAlias', e.target.value);
  });

  // Resolution
  $('#setting-resolution').addEventListener('change', async (e) => {
    config.resolution = e.target.value;
    await window.api.setConfig('resolution', e.target.value);
  });

  // Slot count
  $('#setting-slot-count').addEventListener('change', async (e) => {
    const count = parseInt(e.target.value);
    config.imageSlotCount = count;
    await window.api.setConfig('imageSlotCount', count);
    buildImageSlots(count);
  });

  // Notification sound toggle
  $('#setting-notification-sound').addEventListener('click', async (e) => {
    const toggle = e.currentTarget;
    toggle.classList.toggle('active');
    config.notificationSound = toggle.classList.contains('active');
    await window.api.setConfig('notificationSound', config.notificationSound);
  });

  // Notification sound type
  $('#setting-sound-type').addEventListener('change', async (e) => {
    config.notificationSoundType = e.target.value;
    await window.api.setConfig('notificationSoundType', e.target.value);
    playNotificationSound();
  });

  // Open save folder
  $('#setting-open-folder-btn').addEventListener('click', () => {
    if (config.defaultSavePath) {
      window.api.openFolder(config.defaultSavePath);
    }
  });

  // Save path
  $('#setting-save-path-btn').addEventListener('click', async () => {
    const path = await window.api.selectSavePath();
    if (path) {
      config.defaultSavePath = path;
      $('#save-path-display').textContent = path;
    }
  });

  // API Key
  $('#save-api-key-btn').addEventListener('click', async () => {
    const key = $('#api-key-input').value.trim();
    if (!key) {
      showToast(t('toast.api_key_empty'), 'error');
      return;
    }
    const result = await window.api.setApiKey(key);
    if (!result?.ok) {
      const messageKey = result?.reason === 'secure-storage-unavailable'
        ? 'toast.api_key_secure_storage_unavailable'
        : 'toast.api_key_save_failed';
      showToast(t(messageKey), 'error');
      return;
    }
    config.hasApiKey = true;
    $('#api-key-input').value = '';
    updateApiKeyStatus();
    showToast(t('toast.api_key_saved'), 'success');
  });

  // Auto-save toggles
  const autoSaveToggles = [
    { id: 'setting-auto-save', key: 'autoSaveGenerated' },
    { id: 'setting-save-metadata', key: 'saveMetadata' },
    { id: 'setting-save-source', key: 'saveSourceImages' },
    { id: 'setting-organize-tag', key: 'organizeByTag' },
  ];
  for (const { id, key } of autoSaveToggles) {
    $(`#${id}`).addEventListener('click', async (e) => {
      const toggle = e.currentTarget;
      toggle.classList.toggle('active');
      config[key] = toggle.classList.contains('active');
      await window.api.setConfig(key, config[key]);
    });
  }
}

// ── Presets ──
async function loadPresets() {
  const presets = await window.api.getPresets();
  const select = $('#preset-select');
  const list = $('#preset-list');

  select.innerHTML = `<option value="">${t('generate.preset_custom')}</option>`;
  for (const name of Object.keys(presets)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }

  list.innerHTML = '';
  for (const [name, prompt] of Object.entries(presets)) {
    const item = document.createElement('div');
    item.className = 'preset-item';
    item.innerHTML = `
      <span class="preset-name">${escapeHtml(name)}</span>
      <div style="display:flex;gap:4px">
        <button class="btn-icon" data-preset-edit="${escapeAttr(name)}" title="Edit">✏️</button>
        <button class="btn-icon" data-preset-delete="${escapeAttr(name)}" title="Delete">🗑️</button>
      </div>
    `;
    list.appendChild(item);
  }

  select.onchange = () => {
    const name = select.value;
    if (name && presets[name]) {
      $('#prompt-input').value = presets[name];
    }
  };

  list.querySelectorAll('[data-preset-edit]').forEach(btn => {
    btn.addEventListener('click', () => openPresetModal(btn.dataset.presetEdit, presets[btn.dataset.presetEdit]));
  });
  list.querySelectorAll('[data-preset-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.deletePreset(btn.dataset.presetDelete);
      await loadPresets();
      showToast(t('toast.preset_deleted'), 'success');
    });
  });
}

function setupPresetModal() {
  $('#add-preset-btn').addEventListener('click', () => openPresetModal('', ''));
  $('#preset-modal-cancel').addEventListener('click', closePresetModal);
  $('#preset-modal').addEventListener('click', (e) => {
    if (e.target === $('#preset-modal')) closePresetModal();
  });

  $('#preset-modal-save').addEventListener('click', async () => {
    const name = $('#preset-name-input').value.trim();
    const prompt = $('#preset-prompt-input').value.trim();
    if (!name || !prompt) {
      showToast(t('toast.preset_name_required'), 'error');
      return;
    }
    await window.api.savePreset(name, prompt);
    await loadPresets();
    closePresetModal();
    showToast(t('toast.preset_saved'), 'success');
  });
}

function openPresetModal(name, prompt) {
  $('#preset-modal-title').textContent = name ? t('preset.edit_title') : t('preset.new_title');
  $('#preset-name-input').value = name;
  $('#preset-prompt-input').value = prompt;
  $('#preset-modal').classList.remove('hidden');
}

function closePresetModal() {
  $('#preset-modal').classList.add('hidden');
}

// ── Models ──
function populateModelSelect() {
  const select = $('#setting-model');
  const models = config.models || {};
  select.innerHTML = '';
  for (const name of Object.keys(models)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
}

async function loadModels() {
  const models = await window.api.getModels();
  config.models = models;
  populateModelSelect();
  $('#setting-model').value = config.modelAlias;
  renderModelList();
}

function renderModelList() {
  const list = $('#model-list');
  if (!list) return;
  const models = config.models || {};
  list.innerHTML = '';
  for (const [name, mc] of Object.entries(models)) {
    const item = document.createElement('div');
    item.className = 'preset-item';
    item.innerHTML = `
      <div style="flex:1;min-width:0">
        <span class="preset-name">${escapeHtml(name)}</span>
        <span style="font-size:11px;color:var(--text-tertiary);display:block;margin-top:2px">${escapeHtml(mc.model)}${mc.thinkingLevel ? ` (${escapeHtml(mc.thinkingLevel)})` : ''}</span>
      </div>
    `;
    list.appendChild(item);
  }
}

// ── Keyboard Shortcuts ──
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', async (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleGenerate();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedImageIndex >= 0) {
      const activeEl = document.activeElement;
      const hasTextSelection = activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT') && activeEl.selectionStart !== activeEl.selectionEnd;
      if (!hasTextSelection && !window.getSelection().toString()) {
        e.preventDefault();
        const img = generatedImages[selectedImageIndex];
        if (img) {
          const ok = await window.api.copyImageToClipboard(img.base64);
          showToast(ok ? t('toast.copied') : t('toast.copy_failed'), ok ? 'success' : 'error');
        }
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      navigateToPanel('settings');
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (generatedImages.length > 0) {
        await saveImage(generatedImages[0].base64, `picta-${Date.now()}.png`);
      }
    }
  });
}

// ── Menu Events ──
function setupMenuEvents() {
  window.api.onOpenSettings(() => navigateToPanel('settings'));

  window.api.onSaveImage(async () => {
    if (generatedImages.length > 0) {
      await saveImage(generatedImages[0].base64, `picta-${Date.now()}.png`);
    }
  });

  window.api.onTriggerGenerate(() => handleGenerate());

  window.api.onPasteImage(async () => {
    const base64 = await window.api.getClipboardImage();
    if (base64) {
      const idx = imageSlots.findIndex(s => !s.base64);
      if (idx >= 0) {
        const maxLongEdge = config.maxInputLongEdge || 2048;
        const result = await window.api.resizeImage(base64, 'image/png', maxLongEdge);
        imageSlots[idx].base64 = result.base64;
        imageSlots[idx].mimeType = 'image/png';
        updateSlotUI(idx);
        const msg = result.resized
          ? t('toast.image_pasted_resized', idx + 1)
          : t('toast.image_pasted', idx + 1);
        showToast(msg, 'success');
      } else {
        showToast(t('toast.slots_full'), 'error');
      }
    }
  });
}

// ── Drag & Drop (global) ──
function setupDragDrop() {
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const idx = imageSlots.findIndex(s => !s.base64);
      if (idx >= 0) {
        loadImageToSlot(idx, file);
        showToast(t('toast.image_loaded', idx + 1), 'success');
      }
    }
  });
}

// ── Notification Sound ──
const SOUND_PRESETS = {
  default: { freq: [880, 1100], type: 'sine', duration: 0.4 },
  chime: { freq: [523, 659, 784], type: 'sine', duration: 0.6 },
  bell: { freq: [1200, 800], type: 'triangle', duration: 0.5 },
  soft: { freq: [440, 550], type: 'sine', duration: 0.3 },
};

function playNotificationSound() {
  if (!config.notificationSound) return;
  try {
    const preset = SOUND_PRESETS[config.notificationSoundType] || SOUND_PRESETS.default;
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = audioCtx.createGain();
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + preset.duration);

    const stepDuration = preset.duration / preset.freq.length;
    for (let i = 0; i < preset.freq.length; i++) {
      const osc = audioCtx.createOscillator();
      osc.connect(gain);
      osc.type = preset.type;
      osc.frequency.setValueAtTime(preset.freq[i], audioCtx.currentTime + i * stepDuration);
      osc.start(audioCtx.currentTime + i * stepDuration);
      osc.stop(audioCtx.currentTime + (i + 1) * stepDuration);
    }
  } catch {
    // Ignore audio errors
  }
}

// ── Toast ──
function showToast(message, type = 'success') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ── Utility ──
// escapeHtml, escapeAttr, computeCanvasDims are provided by lib/renderer-utils.js

// ── Auto Update ──
function setupAutoUpdate() {
  window.api.onUpdateAvailable((version, releaseUrl) => {
    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.id = 'update-banner';
    banner.innerHTML = `
      <span>${t('update.available', escapeHtml(version))}</span>
      <button class="btn btn-primary" id="update-open-btn">${t('update.open_release')}</button>
      <button class="btn btn-secondary" id="update-dismiss-btn">${t('update.later')}</button>
    `;
    document.body.appendChild(banner);

    $('#update-open-btn').addEventListener('click', () => {
      window.api.openReleasePage(releaseUrl);
      banner.remove();
    });
    $('#update-dismiss-btn').addEventListener('click', () => banner.remove());
  });
}

// ── Confirm Dialog ──
function showConfirmDialog(title, message, onConfirm) {
  const modal = $('#confirm-modal');
  $('#confirm-modal-title').textContent = title;
  $('#confirm-modal-message').textContent = message;
  $('#confirm-modal-ok').textContent = t('canvas.confirm_ok');
  $('#confirm-modal-cancel').textContent = t('canvas.confirm_cancel');

  const cleanup = () => {
    modal.classList.add('hidden');
    $('#confirm-modal-ok').replaceWith($('#confirm-modal-ok').cloneNode(true));
    $('#confirm-modal-cancel').replaceWith($('#confirm-modal-cancel').cloneNode(true));
  };

  $('#confirm-modal-ok').addEventListener('click', () => { cleanup(); onConfirm(); });
  $('#confirm-modal-cancel').addEventListener('click', cleanup);
  modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); }, { once: true });

  modal.classList.remove('hidden');
}

// ── Image Lightbox ──
function setupImageLightbox() {
  const lightbox = $('#image-lightbox');
  const lightboxImg = $('#lightbox-img');

  lightbox.addEventListener('click', () => lightbox.classList.add('hidden'));

  // Delegate click on slot images
  $('#image-slots').addEventListener('click', (e) => {
    const img = e.target.closest('.slot-placeholder img');
    if (img) {
      e.stopPropagation();
      lightboxImg.src = img.src;
      lightbox.classList.remove('hidden');
    }
  });
}

// ── Shortcut List ──
function buildShortcutList() {
  const mod = platformIsMac ? '⌘' : 'Ctrl';
  const shortcuts = [
    { label: t('settings.shortcut_generate'), keys: [mod, 'Enter'] },
    { label: t('settings.shortcut_save'), keys: [mod, 'S'] },
    { label: t('settings.shortcut_copy'), keys: [mod, 'C'] },
    { label: t('settings.shortcut_paste'), keys: [mod, 'V'] },
    { label: t('settings.shortcut_mention'), keys: ['@'] },
    { label: t('nav.settings'), keys: [mod, ','] },
  ];

  const list = $('#shortcut-list');
  list.innerHTML = '';
  for (const s of shortcuts) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    row.innerHTML = `
      <span class="shortcut-label">${escapeHtml(s.label)}</span>
      <span class="shortcut-keys">${s.keys.map(k => `<span class="kbd">${escapeHtml(k)}</span>`).join('')}</span>
    `;
    list.appendChild(row);
  }
}

// ── Help ──
function buildHelpContent() {
  const mod = platformIsMac ? '⌘' : 'Ctrl';
  const container = $('#help-content');

  const sections = [
    { title: t('help.getting_started'), body: `<p>${t('help.getting_started_body')}</p>` },
    { title: t('help.generate_title'), body: t('help.generate_steps', mod) },
    { title: t('help.edit_title'), body: `<p>${t('help.edit_body')}</p>` },
    { title: t('help.slot_title'), body: `<p>${t('help.slot_body')}</p>` },
    { title: t('help.canvas_title'), body: `<p>${t('help.canvas_body')}</p>` },
    { title: t('help.preset_title'), body: `<p>${t('help.preset_body')}</p>` },
    { title: t('help.history_title'), body: `<p>${t('help.history_body')}</p>` },
  ];

  // Build shortcuts table for help page
  const shortcutRows = [
    [t('settings.shortcut_generate'), [mod, 'Enter']],
    [t('settings.shortcut_save'), [mod, 'S']],
    [t('settings.shortcut_copy'), [mod, 'C']],
    [t('settings.shortcut_paste'), [mod, 'V']],
    [t('settings.shortcut_mention'), ['@']],
    [t('nav.settings'), [mod, ',']],
  ].map(([label, keys]) =>
    `<div class="shortcut-row"><span class="shortcut-label">${escapeHtml(label)}</span><span class="shortcut-keys">${keys.map(k => `<span class="kbd">${escapeHtml(k)}</span>`).join('')}</span></div>`
  ).join('');

  container.innerHTML = `
    <h1>${t('help.title')}</h1>
    ${sections.map(s => `
      <section class="help-section">
        <h2>${s.title}</h2>
        ${s.body}
      </section>
    `).join('')}
    <section class="help-section">
      <h2>${t('help.shortcuts_title')}</h2>
      <div class="shortcut-list">${shortcutRows}</div>
    </section>
  `;
}

// ── Start ──
init();
