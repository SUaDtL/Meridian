import { expect, test } from 'vitest';
import { readSrgbPaint, solidTextContrast } from './solid-text-color';

test('uses unrounded contrast and a large-text cutoff tied to viewed CSS pixels', () => {
  const black = { text: { channels: [0, 0, 0] as const, opacity: 1 }, backing: [255, 255, 255] as const, bold: false };
  expect(solidTextContrast(black, 16)).toEqual({ ratio: 21, threshold: 4.5 });
  expect(solidTextContrast(black, 24).threshold).toBe(3);
  expect(solidTextContrast({ ...black, bold: true }, 56 / 3).threshold).toBe(3);
  expect(solidTextContrast({ ...black, bold: true }, 18.66).threshold).toBe(4.5);
  expect(solidTextContrast({ ...black, text: { ...black.text, opacity: 0.5 } }, 16).ratio).toBeCloseTo(3.97665, 4);
});

test('retains fractional computed channels and declines non-solid or unsupported paint', () => {
  expect(readSrgbPaint('rgba(14.5, 20, 255, 0.4)')).toEqual({ channels: [14.5, 20, 255], opacity: 0.4 });
  expect(readSrgbPaint('url(#gradient)')).toBeUndefined();
  expect(readSrgbPaint('color(display-p3 0.4 0.8 0.6)')).toBeUndefined();
});
