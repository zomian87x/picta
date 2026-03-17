import { describe, it, expect } from 'vitest';
import { resolveModel, extractImage, MODEL_ALIASES } from '../src/lib/models.js';

describe('resolveModel', () => {
  it('returns correct model for "nano banana"', () => {
    const result = resolveModel('nano banana');
    expect(result.model).toBe('gemini-3-pro-image-preview');
    expect(result.thinkingLevel).toBeNull();
  });

  it('returns correct model for "nanobanana 2"', () => {
    const result = resolveModel('nanobanana 2');
    expect(result.model).toBe('gemini-3.1-flash-image-preview');
    expect(result.thinkingLevel).toBe('MINIMAL');
  });

  it('falls back to "nanobanana 2" for unknown alias', () => {
    const result = resolveModel('unknown-model');
    expect(result.model).toBe('gemini-3.1-flash-image-preview');
  });

  it('uses custom aliases when provided', () => {
    const custom = { 'my-model': { model: 'custom-model', thinkingLevel: null } };
    const result = resolveModel('my-model', custom);
    expect(result.model).toBe('custom-model');
  });

  it('falls back to first entry in custom aliases for unknown', () => {
    const custom = { 'first': { model: 'first-model', thinkingLevel: null } };
    const result = resolveModel('nonexistent', custom);
    expect(result.model).toBe('first-model');
  });
});

describe('extractImage', () => {
  it('extracts image data from valid response', () => {
    const response = {
      candidates: [{
        content: {
          parts: [
            { inlineData: { data: 'base64data', mimeType: 'image/png' } },
            { text: 'Generated image' },
          ],
        },
      }],
    };
    const result = extractImage(response);
    expect(result.image).toEqual({ base64: 'base64data', mimeType: 'image/png' });
    expect(result.text).toBe('Generated image');
  });

  it('returns null image for empty candidates', () => {
    const result = extractImage({ candidates: [] });
    expect(result.image).toBeNull();
    expect(result.text).toBe('No response from model');
  });

  it('returns null image when candidates is undefined', () => {
    const result = extractImage({});
    expect(result.image).toBeNull();
  });

  it('handles text-only response', () => {
    const response = {
      candidates: [{
        content: { parts: [{ text: 'Only text' }] },
      }],
    };
    const result = extractImage(response);
    expect(result.image).toBeNull();
    expect(result.text).toBe('Only text');
  });

  it('handles malformed response gracefully', () => {
    const result = extractImage(null);
    expect(result.image).toBeNull();
    expect(result.text).toContain('Error extracting image');
  });
});
