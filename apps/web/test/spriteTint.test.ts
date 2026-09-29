import { describe, expect, it } from 'vitest';
import { MAGENTA, parseTint, tintPixel, tintPixels } from '../src/three/spriteTint.js';

describe('sprite tint', () => {
  it('parses a hex colour', () => {
    expect(parseTint('#c03080')).toEqual([0xc0, 0x30, 0x80]);
  });

  it('shifts the hue toward the tint and keeps black black', () => {
    const [r, g, b] = tintPixel(128, 128, 128, [255, 0, 0]);
    expect(r).toBeGreaterThan(128);
    expect(g).toBeLessThan(128);
    expect(b).toBeLessThan(128);
    expect(tintPixel(0, 0, 0, [255, 0, 0])).toEqual([0, 0, 0]);
  });

  it('is a no-op at zero strength', () => {
    expect(tintPixel(10, 200, 30, [0, 0, 255], 0)).toEqual([10, 200, 30]);
  });

  it('spares team-colour and transparent pixels', () => {
    const m = MAGENTA[5]!;
    const px = new Uint8ClampedArray([
      (m >> 16) & 255, (m >> 8) & 255, m & 255, 255, // team colour
      100, 100, 100, 0, // clear
      100, 100, 100, 255, // body
    ]);
    tintPixels(px, '#0000ff');
    expect([...px.slice(0, 8)]).toEqual([(m >> 16) & 255, (m >> 8) & 255, m & 255, 255, 100, 100, 100, 0]);
    expect(px[10]).toBeGreaterThan(100);
    expect(px[8]).toBeLessThan(100);
  });
});
