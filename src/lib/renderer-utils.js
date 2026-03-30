/**
 * Picta — Shared renderer utilities
 * Works as both CommonJS module (tests) and browser global (renderer).
 */
(function (exports) {
  'use strict';

  const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
  }

  function escapeAttr(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function computeCanvasDims(aspectRatio, resolution) {
    const resPixels = { '1K': 1000000, '2K': 2000000, '4K': 8000000 };
    const ratios = {
      '1:1': [1, 1], '16:9': [16, 9], '3:2': [3, 2], '2:3': [2, 3],
      '9:16': [9, 16], '4:3': [4, 3], '3:4': [3, 4],
    };
    const target = resPixels[resolution] || 1000000;
    const [wr, hr] = ratios[aspectRatio] || [16, 9];
    const r = wr / hr;
    const h = Math.sqrt(target / r);
    const w = h * r;
    const round64 = (x) => Math.max(64, Math.round(x / 64) * 64);
    return { w: round64(w), h: round64(h) };
  }

  function transformMentionsForApi(prompt, imageSlots, lang) {
    return prompt.replace(/@(\S+)/g, (match, label) => {
      const slot = imageSlots.find((s) => s.label === label);
      if (slot && slot.base64) {
        return lang === 'ja'
          ? `\u300C${label}\u300D\u306E\u753B\u50CF`
          : `the image labeled '${label}'`;
      }
      return match;
    });
  }

  function getImageExtensionForMimeType(mimeType) {
    return mimeType === 'image/jpeg' ? 'jpg' : 'png';
  }

  function getLocaleForLanguage(lang) {
    return lang === 'en' ? 'en-US' : 'ja-JP';
  }

  exports.escapeHtml = escapeHtml;
  exports.escapeAttr = escapeAttr;
  exports.computeCanvasDims = computeCanvasDims;
  exports.transformMentionsForApi = transformMentionsForApi;
  exports.getImageExtensionForMimeType = getImageExtensionForMimeType;
  exports.getLocaleForLanguage = getLocaleForLanguage;
})(typeof module !== 'undefined' && module.exports ? module.exports : window);
