import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildPresentationHtml, pngDimensions } from './export';
import { createDocument } from './storage';
import { createScene } from './storyboard';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="100" height="100"/></svg>';

function verifyScript(html: string) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  expect(() => new Script(scripts[0][1])).not.toThrow();
  const expected = createHash('sha256').update(scripts[0][1]).digest('base64');
  expect(html).toContain(`script-src 'sha256-${expected}'`);
  expect(html).not.toContain("script-src 'unsafe-inline'");
  expect(html).toContain("connect-src 'none'");
  expect(html).not.toMatch(/<(?:script|img|iframe)\b[^>]+src=["']https?:/);
}

describe('self-contained presentation export', () => {
  it('uses the same exact PNG dimensions for previews and downloads within browser limits', () => {
    expect(pngDimensions(640, 360, 2)).toEqual({ width: 1280, height: 720 });
    expect(pngDimensions(10_000, 100, 4)).toEqual({ width: 8192, height: 81 });
    const square = pngDimensions(10_000, 10_000, 4);
    expect(square.width).toBe(square.height);
    expect(square.width * square.height).toBeLessThanOrEqual(32_000_000);
    expect(pngDimensions(640, 360, NaN)).toEqual({ width: 1280, height: 720 });
    expect(() => pngDimensions(0, 360, 2)).toThrow(/dimensions/);
  });
  it('retains the legacy playback controls for a diagram without scenes', async () => {
    const html = await buildPresentationHtml(SVG, createDocument());
    verifyScript(html);
    expect(html).toContain('Pause motion');
    expect(html).toContain('Actual size');
    expect(html).toContain('Replay');
  });

  it('exports a complete executable timeline with safely escaped labels and an exact CSP', async () => {
    const doc = createDocument();
    doc.title = '<script>window.stolen=1</script>';
    const scene = createScene();
    scene.title = '</script><img src=x onerror=alert(1)>';
    scene.visible = ['node:a'];
    doc.storyboard = { version: 1, loop: true, scenes: [scene] };
    const html = await buildPresentationHtml(SVG, doc);
    verifyScript(html);
    expect(html).toContain('Choose scene');
    expect(html).toContain('Presentation playhead');
    expect(html).toContain('Previous scene');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>window.stolen');
    expect(html).toContain('\\u003c/script\\u003e');
    expect(html).toContain('data-story-scene');
    expect(html).not.toContain('import(');
  });
});
