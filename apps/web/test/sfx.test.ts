import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  pickTake,
  resolvePlayable,
  resolveSfx,
  SFX_CUES,
  sfxCue,
  STOCK,
  STOCK_CLIPS,
  stockFile,
  voiceFamily,
  type SfxManifest,
} from '../src/audio/sfxCues.js';
import { UNIT_SPRITES } from '../src/three/unitSprites.js';

const manifest = (takes: Record<string, number>): SfxManifest => ({ version: 1, takes });

describe('sound cues', () => {
  it('names each cue once, in a form that is safe as a file name', () => {
    const names = SFX_CUES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('only falls back to cues that exist', () => {
    for (const cue of SFX_CUES) if (cue.fallback) expect(sfxCue(cue.fallback), cue.name).toBeDefined();
  });

  it('asks for the first tier first', () => {
    const tiers = SFX_CUES.map((c) => c.tier);
    expect(tiers).toEqual([...tiers].sort());
  });
});

describe('resolveSfx', () => {
  it('plays a cue that is recorded', () => {
    expect(resolveSfx('hit', manifest({ hit: 3 }))).toBe('hit');
  });

  it('is silent for a cue that is not recorded and has no stand-in', () => {
    expect(resolveSfx('hit', manifest({ swing: 1 }))).toBeNull();
  });

  it('plays the stand-in until the cue itself is recorded', () => {
    expect(resolveSfx('bones-death', manifest({ death: 2 }))).toBe('death');
    expect(resolveSfx('bones-death', manifest({ death: 2, 'bones-death': 1 }))).toBe('bones-death');
    expect(resolveSfx('whoosh-trait', manifest({}))).toBeNull();
  });
});

describe('pickTake', () => {
  it('has only one choice of one take', () => {
    expect(pickTake(1, 1)).toBe(1);
  });

  it('never repeats the last take while there is another', () => {
    for (const last of [1, 2, 3]) {
      for (const r of [0, 0.3, 0.6, 0.999]) {
        const take = pickTake(3, last, () => r);
        expect(take).not.toBe(last);
        expect(take).toBeGreaterThanOrEqual(1);
        expect(take).toBeLessThanOrEqual(3);
      }
    }
  });

  it('can pick any take the first time', () => {
    expect([0, 0.4, 0.8].map((r) => pickTake(3, undefined, () => r))).toEqual([1, 2, 3]);
  });
});

describe('voiceFamily', () => {
  it('gives every sprite in the game a voice', () => {
    const by = (name: string) => voiceFamily(UNIT_SPRITES[name]!);
    expect(by('Ironguard')).toBe('human');
    expect(by('Elvish Fighter')).toBe('human');
    expect(by('Marauder')).toBe('orc');
    expect(by('Wolf-Prowler')).toBe('orc');
    expect(by('Skeleton Rider')).toBe('bones');
    expect(by('Ghost')).toBe('spirit');
    expect(by('Sky-Talon')).toBe('bird');
    expect(by('Vampire Bat')).toBe('bird');
    expect(by('Gryphon Rider')).toBe('bird');
    expect(by('Giant Spider')).toBe('bug');
    expect(by('Giant Rat')).toBe('beast');
    expect(by('Yeti')).toBe('beast');
  });
});

describe('stock sounds', () => {
  const sfxDir = fileURLToPath(new URL('../public/sfx/', import.meta.url));

  it('stand in only for cues that exist, with clip sets that exist', () => {
    for (const [cue, clip] of Object.entries(STOCK)) {
      expect(sfxCue(cue), cue).toBeDefined();
      expect(STOCK_CLIPS[clip!], cue).toBeDefined();
    }
  });

  it('have every variant on disk, and nothing on disk unlisted', () => {
    const listed = Object.entries(STOCK_CLIPS).flatMap(([clip, { count }]) =>
      Array.from({ length: count }, (_, i) => stockFile(clip as keyof typeof STOCK_CLIPS, i + 1).replace('stock/', '')),
    );
    const onDisk = readdirSync(`${sfxDir}stock`).filter((f) => f.endsWith('.mp3'));
    expect(onDisk.sort()).toEqual(listed.sort());
  });

  it('are all credited', () => {
    const credits = readFileSync(`${sfxDir}stock/CREDITS.md`, 'utf8');
    for (const clip of Object.keys(STOCK_CLIPS)) expect(credits, clip).toContain(`\`${clip}-`);
  });

  it('play only while nothing down the chain is recorded', () => {
    expect(resolvePlayable('hit', manifest({}))).toEqual({ cue: 'hit', stock: 'hit' });
    expect(resolvePlayable('hit', manifest({ hit: 2 }))).toEqual({ cue: 'hit' });
    // Down the fallback chain: a recorded stand-in still beats stock.
    expect(resolvePlayable('hoof', manifest({}))).toEqual({ cue: 'step', stock: 'step' });
    expect(resolvePlayable('bones-death', manifest({ death: 1 }))).toEqual({ cue: 'death' });
    expect(resolvePlayable('bones-death', manifest({}))).toEqual({ cue: 'bones-death', stock: 'skeleton-death' });
    expect(resolvePlayable('human-death', manifest({}))).toEqual({ cue: 'death', stock: 'death' });
    expect(resolvePlayable('whoosh-trait', manifest({}))).toEqual({ cue: 'swing', stock: 'swing' });
  });

  it('leave no cue silent but the ambience loops, which are switched off for now', () => {
    for (const cue of SFX_CUES) {
      if (cue.loop) expect(resolvePlayable(cue.name, manifest({})), cue.name).toBeNull();
      else expect(resolvePlayable(cue.name, manifest({})), cue.name).not.toBeNull();
    }
  });
});

