import { createGame, isLegalCommand, reduce } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { SFX_CUES } from '../src/audio/sfxCues.js';
import { stageScene } from '../src/game/effectDemos.js';
import { soundScene } from '../src/game/soundScenes.js';

const FIGHTER = { name: 'Fighter', quality: 3, combat: 3 };
const board = createGame({
  seed: 7,
  board: { width: 12, height: 10 },
  warbands: [[{ ...FIGHTER, pos: { x: 0, y: 0 } }], [{ ...FIGHTER, pos: { x: 11, y: 9 } }]],
});

describe('sound scenes', () => {
  for (const cue of SFX_CUES) {
    const scene = soundScene(cue.name);
    if (!scene) continue;
    it(`${cue.name} has a scene that plays out`, () => {
      const { state, command } = stageScene(board, scene);
      expect(isLegalCommand(state, command)).toBe(true);
      expect(scene.shows(reduce(state, command).events)).toBe(true);
    });
  }

  it('leaves the cues no command plays without a scene', () => {
    expect(soundScene('ui-click')).toBeNull();
    expect(soundScene('amb-table')).toBeNull();
  });
});
