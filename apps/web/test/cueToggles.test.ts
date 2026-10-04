import { describe, expect, it } from 'vitest';
import { cueEnabled, cueReport, DISABLED_SFX, parseOverrides, setCueOverride } from '../src/audio/cueToggles.js';
import { sfxCue } from '../src/audio/sfxCues.js';

describe('sound cue switches', () => {
  it('ships only cues that exist switched off', () => {
    for (const name of DISABLED_SFX) expect(sfxCue(name), name).toBeDefined();
  });

  it('plays a cue unless the defaults or an override switch it off', () => {
    expect(cueEnabled('step', {}, [])).toBe(true);
    expect(cueEnabled('step', {}, ['step'])).toBe(false);
    expect(cueEnabled('step', { step: true }, ['step'])).toBe(true);
    expect(cueEnabled('step', { step: false }, [])).toBe(false);
  });

  it('drops an override once it matches the default again', () => {
    const off = setCueOverride({}, 'hit', false, []);
    expect(off).toEqual({ hit: false });
    expect(setCueOverride(off, 'hit', true, [])).toEqual({});
    expect(setCueOverride({}, 'hit', true, ['hit'])).toEqual({ hit: true });
  });

  it('keeps only known cues with a boolean from storage', () => {
    expect(parseOverrides({ step: false, nonsense: false, hit: 'no' })).toEqual({ step: false });
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides([1, 2])).toEqual({});
  });

  it('reports the full list to ship off, and what changed from the defaults', () => {
    const report = cueReport({ 'ui-hover': false, step: true }, ['step', 'dizzy']);
    expect(report.disabled).toEqual(['dizzy', 'ui-hover']);
    expect(report.newlyDisabled).toEqual(['ui-hover']);
    expect(report.reEnabled).toEqual(['step']);
  });
});
