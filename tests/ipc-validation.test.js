import { describe, it, expect } from 'vitest';
import {
  validateConfigSet,
  validatePresetInput,
  validateHistoryEntry,
  validateEditRequest,
  validateAutoSavePayload,
  toSafePathSegment,
} from '../src/lib/ipc-validation.js';

describe('validateConfigSet', () => {
  it('allows known writable keys only', () => {
    expect(validateConfigSet('theme', 'dark')).toEqual({ key: 'theme', value: 'dark' });
    expect(() => validateConfigSet('defaultSavePath', '/tmp')).toThrow('Config key is not writable');
  });
});

describe('validatePresetInput', () => {
  it('rejects reserved object keys', () => {
    expect(() => validatePresetInput('__proto__', 'test')).toThrow('reserved');
  });
});

describe('validateHistoryEntry', () => {
  it('normalizes tags and preserves valid fields', () => {
    const entry = validateHistoryEntry({
      timestamp: '2026-03-17T12:34:56.000Z',
      prompt: 'prompt',
      modelAlias: 'nanobanana 2',
      imageCount: 1,
      tags: ['tag-a', 'tag-a', 'tag-b'],
      thumbnail: 'QUJDRA==',
    });

    expect(entry.tags).toEqual(['tag-a', 'tag-b']);
    expect(entry.thumbnail).toBe('QUJDRA==');
  });
});

describe('validateEditRequest', () => {
  it('rejects more than 3 images', () => {
    const request = {
      prompt: 'edit this',
      aspectRatio: '16:9',
      imageSize: '2K',
      modelAlias: 'nanobanana 2',
      images: [
        { base64: 'QUJDRA==', mimeType: 'image/png' },
        { base64: 'QUJDRA==', mimeType: 'image/png' },
        { base64: 'QUJDRA==', mimeType: 'image/png' },
        { base64: 'QUJDRA==', mimeType: 'image/png' },
      ],
    };

    expect(() => validateEditRequest(request)).toThrow('images must contain 1 to 3 items');
  });
});

describe('validateAutoSavePayload', () => {
  it('accepts valid payloads and keeps tags', () => {
    const payload = validateAutoSavePayload({
      base64: 'QUJDRA==',
      mimeType: 'image/png',
      metadata: {
        prompt: 'prompt',
        modelAlias: 'nanobanana 2',
        aspectRatio: '16:9',
        resolution: '2K',
        timestamp: '2026-03-17T12:34:56.000Z',
        tags: ['scene'],
      },
      sourceImages: [{ base64: 'QUJDRA==', mimeType: 'image/png' }],
    });

    expect(payload.metadata.tags).toEqual(['scene']);
    expect(payload.sourceImages).toHaveLength(1);
  });
});

describe('toSafePathSegment', () => {
  it('strips traversal and path separators', () => {
    expect(toSafePathSegment('../secret/../../folder')).toBe('secret-..-..-folder');
    expect(toSafePathSegment('...')).toBe('');
  });
});
