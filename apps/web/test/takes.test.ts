import { describe, expect, it } from 'vitest';
import { cutTake, encodeWav, findTakes, resample, takesFrom, TAKE_RATE } from '../src/audio/takes.js';

const RATE = 48000;

/** A recording: faint room noise throughout, with a tone over each `[fromMs, toMs]`. */
function recording(ms: number, tones: [number, number][], loud = 0.5): Float32Array {
  const out = new Float32Array((RATE * ms) / 1000);
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (seed / 0x7fffffff - 0.5) * 0.002;
  }
  for (const [from, to] of tones) {
    for (let i = (RATE * from) / 1000; i < (RATE * to) / 1000; i++) {
      out[i] = out[i]! + loud * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }
  }
  return out;
}

const ms = (samples: number) => (samples / RATE) * 1000;
const peak = (samples: Float32Array) => samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0);

describe('findTakes', () => {
  it('finds nothing in a quiet room', () => {
    expect(findTakes(recording(1500, []), RATE, 3)).toEqual([]);
  });

  it('splits sounds that have a pause between them', () => {
    const takes = findTakes(recording(3000, [[300, 600], [1300, 1700], [2400, 2700]]), RATE, 3);
    expect(takes).toHaveLength(3);
    // Each take is its sound with a little air either side.
    expect(ms(takes[1]!.start)).toBeGreaterThan(1200);
    expect(ms(takes[1]!.start)).toBeLessThanOrEqual(1300);
    expect(ms(takes[1]!.end)).toBeGreaterThanOrEqual(1700);
    expect(ms(takes[1]!.end)).toBeLessThan(1800);
  });

  it('keeps a sound with a short pause inside it whole', () => {
    expect(findTakes(recording(2000, [[300, 500], [700, 900]]), RATE, 3)).toHaveLength(1);
  });

  it('treats everything as one take for a cue that wants one', () => {
    const takes = findTakes(recording(3000, [[300, 600], [1500, 1800]]), RATE, 1);
    expect(takes).toHaveLength(1);
    expect(ms(takes[0]!.start)).toBeLessThanOrEqual(300);
    expect(ms(takes[0]!.end)).toBeGreaterThanOrEqual(1800);
  });

  it('ignores a click', () => {
    expect(findTakes(recording(2000, [[300, 315], [1000, 1400]]), RATE, 3)).toHaveLength(1);
  });

  it('hears a quiet sound beside a loud one', () => {
    const quiet = recording(3000, [[2000, 2400]], 0.06);
    const both = recording(3000, [[300, 700]]).map((s, i) => s + quiet[i]!);
    expect(findTakes(both, RATE, 2)).toHaveLength(2);
  });
});

describe('cutTake', () => {
  it('brings every take to the same peak and fades its ends', () => {
    const samples = recording(1000, [[200, 600]], 0.1);
    const [range] = findTakes(samples, RATE, 1);
    const cut = cutTake(samples, range!, RATE);
    expect(peak(cut)).toBeCloseTo(0.89, 2);
    expect(cut[0]).toBe(0);
    expect(cut[cut.length - 1]).toBe(0);
  });
});

describe('resample', () => {
  it('halves the length going from 48 kHz to 24 kHz and keeps the tone', () => {
    const samples = recording(500, [[0, 500]]);
    const out = resample(samples, RATE, TAKE_RATE);
    expect(out).toHaveLength(samples.length / 2);
    expect(peak(out)).toBeGreaterThan(0.45);
  });

  it('leaves audio already at the right rate alone', () => {
    const samples = recording(100, []);
    expect(resample(samples, TAKE_RATE, TAKE_RATE)).toBe(samples);
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono WAV', () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5]), TAKE_RATE);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(TAKE_RATE);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(8);
    expect(wav).toHaveLength(44 + 8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32767, 16384]);
  });
});

describe('takesFrom', () => {
  it('turns a recording into one finished file per take', () => {
    const files = takesFrom(recording(3000, [[300, 600], [1300, 1700], [2400, 2700]]), RATE, 3);
    expect(files).toHaveLength(3);
    for (const file of files) expect(String.fromCharCode(...file.subarray(0, 4))).toBe('RIFF');
  });
});
