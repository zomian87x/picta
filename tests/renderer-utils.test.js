import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  escapeAttr,
  computeCanvasDims,
  transformMentionsForApi,
  getImageExtensionForMimeType,
  getLocaleForLanguage,
} from '../src/lib/renderer-utils.js';

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('passes through safe strings', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('returns empty string for non-string input', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(123)).toBe('');
  });
});

describe('escapeAttr', () => {
  it('escapes double quotes', () => {
    expect(escapeAttr('a"b')).toBe('a&quot;b');
  });

  it('escapes single quotes', () => {
    expect(escapeAttr("a'b")).toBe('a&#39;b');
  });

  it('returns empty string for non-string input', () => {
    expect(escapeAttr(null)).toBe('');
  });
});

describe('computeCanvasDims', () => {
  it('returns correct dims for 1:1 at 1K', () => {
    const { w, h } = computeCanvasDims('1:1', '1K');
    expect(w).toBe(h);
    expect(w * h).toBeGreaterThan(800000);
    expect(w * h).toBeLessThan(1200000);
  });

  it('returns correct dims for 16:9 at 2K', () => {
    const { w, h } = computeCanvasDims('16:9', '2K');
    expect(w).toBeGreaterThan(h);
    const ratio = w / h;
    expect(ratio).toBeCloseTo(16 / 9, 0);
  });

  it('rounds to nearest 64', () => {
    const { w, h } = computeCanvasDims('1:1', '1K');
    expect(w % 64).toBe(0);
    expect(h % 64).toBe(0);
  });

  it('returns minimum 64 for very small values', () => {
    const { w, h } = computeCanvasDims('1:1', '1K');
    expect(w).toBeGreaterThanOrEqual(64);
    expect(h).toBeGreaterThanOrEqual(64);
  });

  it('falls back for unknown aspect ratio', () => {
    const { w, h } = computeCanvasDims('unknown', '1K');
    expect(w).toBeGreaterThan(h);
  });

  it('falls back for unknown resolution', () => {
    const { w, h } = computeCanvasDims('1:1', 'unknown');
    expect(w * h).toBeGreaterThan(800000);
    expect(w * h).toBeLessThan(1200000);
  });
});

describe('transformMentionsForApi', () => {
  const slots = [
    { label: 'person', base64: 'abc', mimeType: 'image/png' },
    { label: 'bg', base64: 'def', mimeType: 'image/png' },
    { label: 'empty', base64: null, mimeType: null },
  ];

  it('replaces @label with Japanese text when lang is ja', () => {
    const result = transformMentionsForApi('@person を編集', slots, 'ja');
    expect(result).toBe('「person」の画像 を編集');
  });

  it('replaces @label with English text when lang is en', () => {
    const result = transformMentionsForApi('edit @person', slots, 'en');
    expect(result).toBe("edit the image labeled 'person'");
  });

  it('leaves @label unchanged if slot has no image', () => {
    const result = transformMentionsForApi('@empty test', slots, 'ja');
    expect(result).toBe('@empty test');
  });

  it('leaves @label unchanged if slot not found', () => {
    const result = transformMentionsForApi('@nonexistent test', slots, 'ja');
    expect(result).toBe('@nonexistent test');
  });

  it('handles multiple mentions', () => {
    const result = transformMentionsForApi('@person and @bg', slots, 'en');
    expect(result).toContain("the image labeled 'person'");
    expect(result).toContain("the image labeled 'bg'");
  });
});

describe('getImageExtensionForMimeType', () => {
  it('returns jpg for jpeg images', () => {
    expect(getImageExtensionForMimeType('image/jpeg')).toBe('jpg');
  });

  it('falls back to png for other MIME types', () => {
    expect(getImageExtensionForMimeType('image/png')).toBe('png');
    expect(getImageExtensionForMimeType('image/webp')).toBe('png');
  });
});

describe('getLocaleForLanguage', () => {
  it('returns en-US for english UI', () => {
    expect(getLocaleForLanguage('en')).toBe('en-US');
  });

  it('returns ja-JP for japanese UI and fallback', () => {
    expect(getLocaleForLanguage('ja')).toBe('ja-JP');
    expect(getLocaleForLanguage('unknown')).toBe('ja-JP');
  });
});
