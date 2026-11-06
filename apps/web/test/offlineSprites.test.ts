import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '@fansong/content';
import { spriteFiles, spritesToKeep } from '../src/ui/offlineSprites.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

describe('spriteFiles', () => {
  it("lists a look's base image, its frames and its missile", () => {
    const files = spriteFiles('Longbow');
    expect(files[0]).toBe('sprites/units/human-loyalists/longbowman.png');
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('sprites/projectiles/missile-n.png');
  });

  it('falls back to the default sprite for a name with no look', () => {
    expect(spriteFiles('Nobody')[0]).toBe('sprites/units/human-loyalists/spearman.png');
  });
});

describe('spritesToKeep', () => {
  const files = spritesToKeep(Object.values(PRESETS));

  it('names each file of the preset warbands once, all of them art the worker fetches on demand', () => {
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) expect(file).toMatch(/^sprites\/(units|projectiles)\//);
  });

  it('names only files that are in the build', () => {
    for (const file of files) expect(existsSync(publicDir + file), file).toBe(true);
  });

  it('is a small part of all the unit art', () => {
    expect(files.length).toBeLessThan(1500);
  });
});
