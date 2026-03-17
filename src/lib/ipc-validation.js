(function (exports) {
  'use strict';

  const THEMES = new Set(['system', 'light', 'dark']);
  const LANGUAGES = new Set(['ja', 'en']);
  const RESOLUTIONS = new Set(['1K', '2K', '4K']);
  const ASPECT_RATIOS = new Set(['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16']);
  const SOUND_TYPES = new Set(['default', 'chime', 'bell', 'soft']);
  const RESERVED_RECORD_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function validationError(message) {
    const err = new Error(message);
    err.code = 'VALIDATION_ERROR';
    return err;
  }

  function assert(condition, message) {
    if (!condition) {
      throw validationError(message);
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function ensurePlainObject(value, field) {
    assert(isPlainObject(value), `${field} must be an object`);
    return value;
  }

  function ensureString(value, field, maxLength, options = {}) {
    assert(typeof value === 'string', `${field} must be a string`);
    const out = options.trim === false ? value : value.trim();
    if (options.allowEmpty !== true) {
      assert(out.length > 0, `${field} is required`);
    }
    assert(out.length <= maxLength, `${field} is too long`);
    return out;
  }

  function ensureBoolean(value, field) {
    assert(typeof value === 'boolean', `${field} must be a boolean`);
    return value;
  }

  function ensureInteger(value, field, min, max) {
    assert(Number.isInteger(value), `${field} must be an integer`);
    assert(value >= min && value <= max, `${field} is out of range`);
    return value;
  }

  function ensureChoice(value, field, allowedValues, maxLength = 64) {
    const out = ensureString(value, field, maxLength);
    assert(allowedValues.has(out), `${field} is invalid`);
    return out;
  }

  function ensureTimestamp(value) {
    const out = ensureString(value, 'timestamp', 64);
    assert(!Number.isNaN(Date.parse(out)), 'timestamp is invalid');
    return out;
  }

  function ensureRecordName(value, field = 'name') {
    const out = ensureString(value, field, 120);
    assert(!RESERVED_RECORD_NAMES.has(out), `${field} is reserved`);
    return out;
  }

  function ensureImageMimeType(value, field = 'mimeType') {
    const out = ensureString(value, field, 100);
    assert(out.startsWith('image/'), `${field} must be an image MIME type`);
    return out;
  }

  function ensureBase64(value, field, maxLength) {
    const out = ensureString(value, field, maxLength, { trim: true });
    assert(/^[A-Za-z0-9+/=]+$/.test(out), `${field} must be base64`);
    return out;
  }

  function normalizeTags(value) {
    assert(Array.isArray(value), 'tags must be an array');
    assert(value.length <= 20, 'tags has too many items');
    const out = [];
    const seen = new Set();
    for (const tag of value) {
      const normalized = ensureString(tag, 'tag', 40);
      if (RESERVED_RECORD_NAMES.has(normalized) || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  function validateConfigSet(key, value) {
    const safeKey = ensureString(key, 'key', 64, { trim: false });
    switch (safeKey) {
      case 'theme':
        return { key: safeKey, value: ensureChoice(value, 'theme', THEMES) };
      case 'language':
        return { key: safeKey, value: ensureChoice(value, 'language', LANGUAGES) };
      case 'modelAlias':
        return { key: safeKey, value: ensureRecordName(value, 'model alias') };
      case 'resolution':
        return { key: safeKey, value: ensureChoice(value, 'resolution', RESOLUTIONS) };
      case 'imageSlotCount':
        return { key: safeKey, value: ensureInteger(value, 'imageSlotCount', 2, 5) };
      case 'notificationSound':
      case 'autoSaveGenerated':
      case 'saveMetadata':
      case 'saveSourceImages':
      case 'organizeByTag':
        return { key: safeKey, value: ensureBoolean(value, safeKey) };
      case 'notificationSoundType':
        return { key: safeKey, value: ensureChoice(value, 'notificationSoundType', SOUND_TYPES) };
      case 'maxInputLongEdge':
        return { key: safeKey, value: ensureInteger(value, 'maxInputLongEdge', 256, 8192) };
      default:
        throw validationError('Config key is not writable');
    }
  }

  function validateApiKey(value) {
    return ensureString(value, 'apiKey', 4096);
  }

  function validatePresetInput(name, prompt) {
    return {
      name: ensureRecordName(name, 'preset name'),
      prompt: ensureString(prompt, 'prompt', 10000),
    };
  }

  function validateDeleteName(name, field) {
    return ensureRecordName(name, field);
  }

  function validateModelInput(name, modelConfig) {
    const safeConfig = ensurePlainObject(modelConfig, 'modelConfig');
    let thinkingLevel = null;
    if (safeConfig.thinkingLevel !== null && safeConfig.thinkingLevel !== undefined && safeConfig.thinkingLevel !== '') {
      thinkingLevel = ensureString(safeConfig.thinkingLevel, 'thinkingLevel', 32);
    }
    return {
      name: ensureRecordName(name, 'model alias'),
      modelConfig: {
        model: ensureString(safeConfig.model, 'model', 120),
        thinkingLevel,
      },
    };
  }

  function validateHistoryEntry(entry) {
    const safeEntry = ensurePlainObject(entry, 'entry');
    const out = {
      timestamp: ensureTimestamp(safeEntry.timestamp),
      prompt: ensureString(safeEntry.prompt, 'prompt', 10000),
      modelAlias: ensureString(safeEntry.modelAlias, 'modelAlias', 120),
      imageCount: ensureInteger(safeEntry.imageCount ?? 1, 'imageCount', 1, 4),
      favorite: safeEntry.favorite === undefined ? false : ensureBoolean(safeEntry.favorite, 'favorite'),
      tags: safeEntry.tags === undefined ? [] : normalizeTags(safeEntry.tags),
    };

    if (safeEntry.operation !== undefined) {
      out.operation = ensureString(safeEntry.operation, 'operation', 40);
    }
    if (safeEntry.aspectRatio !== undefined) {
      out.aspectRatio = ensureChoice(safeEntry.aspectRatio, 'aspectRatio', ASPECT_RATIOS);
    }
    if (safeEntry.resolution !== undefined) {
      out.resolution = ensureChoice(safeEntry.resolution, 'resolution', RESOLUTIONS);
    }
    if (safeEntry.thumbnail !== undefined) {
      out.thumbnail = ensureBase64(safeEntry.thumbnail, 'thumbnail', 5000);
    }
    if (safeEntry.thumbnailFull !== undefined) {
      out.thumbnailFull = ensureBase64(safeEntry.thumbnailFull, 'thumbnailFull', 25 * 1024 * 1024);
    }
    return out;
  }

  function validateHistoryTagsUpdate(timestamp, tags) {
    return {
      timestamp: ensureTimestamp(timestamp),
      tags: normalizeTags(tags),
    };
  }

  function validateImagePayload(image, field, maxLength = 25 * 1024 * 1024) {
    const safeImage = ensurePlainObject(image, field);
    return {
      base64: ensureBase64(safeImage.base64, `${field}.base64`, maxLength),
      mimeType: ensureImageMimeType(safeImage.mimeType || 'image/png', `${field}.mimeType`),
    };
  }

  function validateGenerateRequest(request) {
    const safeRequest = ensurePlainObject(request, 'request');
    return {
      prompt: ensureString(safeRequest.prompt, 'prompt', 10000),
      aspectRatio: ensureChoice(safeRequest.aspectRatio, 'aspectRatio', ASPECT_RATIOS),
      imageSize: ensureChoice(safeRequest.imageSize, 'imageSize', RESOLUTIONS),
      modelAlias: ensureRecordName(safeRequest.modelAlias, 'modelAlias'),
    };
  }

  function validateEditRequest(request) {
    const safeRequest = validateGenerateRequest(request);
    assert(Array.isArray(request.images), 'images must be an array');
    assert(request.images.length > 0 && request.images.length <= 3, 'images must contain 1 to 3 items');
    safeRequest.images = request.images.map((image, index) => validateImagePayload(image, `images[${index}]`));
    return safeRequest;
  }

  function validateSaveImageRequest(token, base64Data) {
    const safeToken = ensureString(token, 'token', 64);
    assert(UUID_RE.test(safeToken), 'token is invalid');
    return {
      token: safeToken,
      base64Data: ensureBase64(base64Data, 'base64Data', 25 * 1024 * 1024),
    };
  }

  function validateResizeRequest(base64, mimeType, maxLongEdge) {
    return {
      base64: ensureBase64(base64, 'base64', 25 * 1024 * 1024),
      mimeType: ensureImageMimeType(mimeType),
      maxLongEdge: ensureInteger(maxLongEdge, 'maxLongEdge', 256, 8192),
    };
  }

  function validateAutoSavePayload(params) {
    const safeParams = ensurePlainObject(params, 'params');
    const metadata = ensurePlainObject(safeParams.metadata, 'metadata');
    const out = {
      base64: ensureBase64(safeParams.base64, 'base64', 25 * 1024 * 1024),
      mimeType: ensureImageMimeType(safeParams.mimeType),
      metadata: {
        prompt: ensureString(metadata.prompt, 'metadata.prompt', 10000),
        modelAlias: ensureString(metadata.modelAlias, 'metadata.modelAlias', 120),
        aspectRatio: ensureChoice(metadata.aspectRatio, 'metadata.aspectRatio', ASPECT_RATIOS),
        resolution: ensureChoice(metadata.resolution, 'metadata.resolution', RESOLUTIONS),
        timestamp: ensureTimestamp(metadata.timestamp),
        tags: metadata.tags === undefined ? [] : normalizeTags(metadata.tags),
      },
      sourceImages: [],
    };

    if (safeParams.sourceImages !== undefined) {
      assert(Array.isArray(safeParams.sourceImages), 'sourceImages must be an array');
      assert(safeParams.sourceImages.length <= 3, 'sourceImages has too many items');
      out.sourceImages = safeParams.sourceImages.map((image, index) =>
        validateImagePayload(image, `sourceImages[${index}]`)
      );
    }

    return out;
  }

  function toSafePathSegment(value) {
    if (typeof value !== 'string') {
      return '';
    }
    let out = value.trim();
    if (typeof out.normalize === 'function') {
      out = out.normalize('NFKC');
    }
    out = out.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
    out = out.replace(/\s+/g, ' ');
    out = out.replace(/^\.+/, '');
    out = out.replace(/\.+$/, '');
    out = out.trim().replace(/^[-\s]+/, '').replace(/[-\s]+$/, '').slice(0, 64);
    if (!out || out === '.' || out === '..') {
      return '';
    }
    return out;
  }

  exports.validateConfigSet = validateConfigSet;
  exports.validateApiKey = validateApiKey;
  exports.validatePresetInput = validatePresetInput;
  exports.validateDeleteName = validateDeleteName;
  exports.validateModelInput = validateModelInput;
  exports.validateHistoryEntry = validateHistoryEntry;
  exports.validateHistoryTagsUpdate = validateHistoryTagsUpdate;
  exports.validateGenerateRequest = validateGenerateRequest;
  exports.validateEditRequest = validateEditRequest;
  exports.validateSaveImageRequest = validateSaveImageRequest;
  exports.validateResizeRequest = validateResizeRequest;
  exports.validateAutoSavePayload = validateAutoSavePayload;
  exports.toSafePathSegment = toSafePathSegment;
})(typeof module !== 'undefined' && module.exports ? module.exports : window);
