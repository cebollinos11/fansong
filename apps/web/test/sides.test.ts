import type { MatchSetup } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import { COLOR_NAMES, sideDoes, sideName, sideNames, sidePossessive, sideVerb } from '../src/ui/sides.js';

const setup = (seats: MatchSetup['seats']): MatchSetup => ({
  presets: ['iron-wardens-medium', 'ashfang-raiders-medium'],
  seats,
  seed: 1,
});

describe('sideNames', () => {
  it('names the sides as the top bar does', () => {
    expect(sideNames(setup(['human', 'ai']), [0])).toEqual(['You', 'AI']);
    expect(sideNames(setup(['ai', 'human']), [1])).toEqual(['AI', 'You']);
    expect(sideNames(setup(['human', 'human']), [1])).toEqual(['Opponent', 'You']);
    const hotseat = sideNames(setup(['human', 'human']), [0, 1]);
    expect(hotseat).not.toContain('You');
    expect(hotseat[0]).not.toBe(hotseat[1]);
  });
});

describe('side grammar', () => {
  const names = ['You', 'AI'] as const;

  it('lower-cases "you" mid-sentence and agrees verbs with it', () => {
    expect(sideName(names, 0)).toBe('you');
    expect(sideName(names, 0, true)).toBe('You');
    expect(sideName(names, 1)).toBe('AI');
    expect(sideDoes(names, 0, 'wins', true)).toBe('You win');
    expect(sideDoes(names, 1, 'wins', true)).toBe('AI wins');
    expect(sideVerb(names, 0, 'is')).toBe('are');
    expect(sideVerb(names, 0, 'has')).toBe('have');
    expect(sideVerb(names, 0, 'reaches')).toBe('reach');
    expect(sideVerb(names, 0, 'captures')).toBe('capture');
  });

  it('makes possessives, including for names ending in s', () => {
    expect(sidePossessive(names, 0, true)).toBe('Your');
    expect(sidePossessive(names, 0)).toBe('your');
    expect(sidePossessive(names, 1)).toBe("AI's");
    expect(sidePossessive(['Iron Wardens', 'Ashfang Raiders'], 1)).toBe("Ashfang Raiders'");
    expect(sidePossessive(COLOR_NAMES, 0)).toBe("Blue's");
  });
});
