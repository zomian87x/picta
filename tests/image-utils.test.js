import { describe, it, expect } from 'vitest';
import { computeResizeDimensions } from '../src/lib/image-utils.js';

describe('computeResizeDimensions', () => {
  it('does not resize when within limit', () => {
    const result = computeResizeDimensions(1000, 800, 2048);
    expect(result.needsResize).toBe(false);
    expect(result.newW).toBe(1000);
    expect(result.newH).toBe(800);
  });

  it('does not resize when exactly at limit', () => {
    const result = computeResizeDimensions(2048, 1024, 2048);
    expect(result.needsResize).toBe(false);
  });

  it('scales down when width exceeds limit', () => {
    const result = computeResizeDimensions(4096, 2048, 2048);
    expect(result.needsResize).toBe(true);
    expect(result.newW).toBe(2048);
    expect(result.newH).toBe(1024);
  });

  it('scales down when height exceeds limit', () => {
    const result = computeResizeDimensions(1000, 4000, 2048);
    expect(result.needsResize).toBe(true);
    expect(result.newH).toBe(2048);
    expect(result.newW).toBe(512);
  });

  it('preserves aspect ratio', () => {
    const result = computeResizeDimensions(3000, 2000, 1500);
    expect(result.needsResize).toBe(true);
    const originalRatio = 3000 / 2000;
    const newRatio = result.newW / result.newH;
    expect(newRatio).toBeCloseTo(originalRatio, 1);
  });

  it('handles square images', () => {
    const result = computeResizeDimensions(4000, 4000, 2048);
    expect(result.needsResize).toBe(true);
    expect(result.newW).toBe(2048);
    expect(result.newH).toBe(2048);
  });
});
