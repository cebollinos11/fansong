/**
 * Turning a stretch of microphone samples into finished takes: find the sounds
 * in it, cut each out with a little air either side, bring them to one loudness
 * and encode them as WAV. Pure sample arithmetic (mono, -1..1), so the recording
 * booth and the tests share it.
 */

/** A sound found in a recording: sample offsets, `end` exclusive. */
export interface TakeRange {
  start: number;
  end: number;
}

/** The sample rate takes are stored at: plenty for a voice, and half the size of the microphone's. */
export const TAKE_RATE = 24000;

const WINDOW_MS = 10;
/** Silence this long between two sounds makes them separate takes. */
const TAKE_GAP_MS = 450;
/** Anything shorter than this is a click, not a take. */
const MIN_TAKE_MS = 40;
const PAD_MS = 40;
const FADE_MS = 8;
const PEAK = 0.89;

/** Loudness (root mean square) of each {@link WINDOW_MS} window of `samples`. */
export function windowLevels(samples: Float32Array, rate: number): Float32Array {
  const size = Math.max(1, Math.round((rate * WINDOW_MS) / 1000));
  const levels = new Float32Array(Math.floor(samples.length / size));
  for (let w = 0; w < levels.length; w++) {
    let sum = 0;
    for (let i = w * size; i < (w + 1) * size; i++) sum += samples[i]! * samples[i]!;
    levels[w] = Math.sqrt(sum / size);
  }
  return levels;
}

/**
 * The level above which a window counts as sound: well clear of the room's own
 * noise (the quiet tenth of the recording), and of the far tail of the loudest
 * sound in it.
 */
export function gateLevel(levels: Float32Array): number {
  if (levels.length === 0) return Infinity;
  const sorted = Float32Array.from(levels).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)]!;
  const peak = sorted[sorted.length - 1]!;
  return Math.max(0.004, floor * 3, peak * 0.06);
}

/**
 * The sounds in a recording, in order. A cue that wants one take gets
 * everything from the first sound to the last as a single take, pauses and all
 * (a "lub-dub" is one sound); one that wants several is split wherever there is
 * {@link TAKE_GAP_MS} of silence.
 */
export function findTakes(samples: Float32Array, rate: number, want: number): TakeRange[] {
  const levels = windowLevels(samples, rate);
  const gate = gateLevel(levels);
  const size = Math.max(1, Math.round((rate * WINDOW_MS) / 1000));
  const gap = TAKE_GAP_MS / WINDOW_MS;
  const runs: { from: number; to: number; loud: number }[] = [];
  for (let w = 0; w < levels.length; w++) {
    if (levels[w]! <= gate) continue;
    const last = runs[runs.length - 1];
    if (last && w - last.to <= gap) {
      last.to = w + 1;
      last.loud++;
    } else {
      runs.push({ from: w, to: w + 1, loud: 1 });
    }
  }
  const sounds = runs.filter((r) => r.loud * WINDOW_MS >= MIN_TAKE_MS);
  if (sounds.length === 0) return [];
  const kept = want <= 1 ? [{ from: sounds[0]!.from, to: sounds[sounds.length - 1]!.to }] : sounds;
  const pad = Math.round((rate * PAD_MS) / 1000);
  return kept.map((r) => ({
    start: Math.max(0, r.from * size - pad),
    end: Math.min(samples.length, r.to * size + pad),
  }));
}

/** One take cut out of a recording: faded in and out, and brought up (or down) to a common peak. */
export function cutTake(samples: Float32Array, range: TakeRange, rate: number): Float32Array {
  const out = samples.slice(range.start, range.end);
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 1e-4 ? PEAK / peak : 1;
  const fade = Math.min(Math.floor(out.length / 2), Math.round((rate * FADE_MS) / 1000));
  for (let i = 0; i < out.length; i++) {
    const edge = Math.min(i, out.length - 1 - i);
    out[i] = out[i]! * gain * (edge < fade ? edge / fade : 1);
  }
  return out;
}

/** `samples` at another rate. Going down, each new sample is the mean of the old ones it covers. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const step = from / to;
  const out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i++) {
    const a = i * step;
    if (step <= 1) {
      const k = a - Math.floor(a);
      const lo = samples[Math.floor(a)]!;
      out[i] = lo + ((samples[Math.min(samples.length - 1, Math.floor(a) + 1)] ?? lo) - lo) * k;
      continue;
    }
    const end = Math.min(samples.length, Math.max(Math.floor(a) + 1, Math.floor(a + step)));
    let sum = 0;
    for (let j = Math.floor(a); j < end; j++) sum += samples[j]!;
    out[i] = sum / (end - Math.floor(a));
  }
  return out;
}

/** `samples` as a 16-bit mono WAV file. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return bytes;
}

/** Everything the booth does to one cue's recording: its takes, each a finished WAV at {@link TAKE_RATE}. */
export function takesFrom(samples: Float32Array, rate: number, want: number): Uint8Array[] {
  return findTakes(samples, rate, want).map((range) => encodeWav(resample(cutTake(samples, range, rate), rate, TAKE_RATE), TAKE_RATE));
}
