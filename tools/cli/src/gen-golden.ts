/**
 * Regenerate the committed golden replay fixture.
 *
 *   pnpm --filter @fansong/cli gen:golden
 *
 * Records a deterministic AI-vs-AI game as a `Replay` (config + command list) and
 * writes it, together with the hash of the reproduced final state, to
 * `packages/engine/test/fixtures/golden-replay.json`. The golden test then
 * replays that fixture and asserts the same hash, so an *accidental* rule change
 * breaks the test; run this script to bless an *intentional* one.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseCommand } from '@fansong/ai';
import { hashGameState, recordReplay, runReplay, type GameConfig } from '@fansong/engine';

// A fixed, self-contained matchup — independent of the presets so the fixture is
// stable even if preset stat lines are tuned. Exercises movement, melee, dice,
// ranged fire (Marksman/Slinger) and the Tough trait (Shieldbearer/Warder).
const config: GameConfig = {
  seed: 1337,
  board: { width: 10, height: 8 },
  warbands: [
    [
      { name: 'Vanguard', quality: 3, combat: 4, pos: { x: 0, y: 2 } },
      { name: 'Marksman', quality: 3, combat: 2, ranged: 4, pos: { x: 0, y: 4 } },
      { name: 'Shieldbearer', quality: 4, combat: 3, tough: true, pos: { x: 0, y: 6 } },
    ],
    [
      { name: 'Reaver', quality: 3, combat: 4, pos: { x: 9, y: 2 } },
      { name: 'Slinger', quality: 3, combat: 2, ranged: 4, pos: { x: 9, y: 4 } },
      { name: 'Warder', quality: 4, combat: 3, tough: true, pos: { x: 9, y: 6 } },
    ],
  ],
};

const replay = recordReplay(config, chooseCommand);
const { final } = runReplay(replay);
const finalHash = hashGameState(final);

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../packages/engine/test/fixtures/golden-replay.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ replay, finalHash }, null, 2) + '\n');

console.log(
  `Wrote ${out}\n  commands: ${replay.commands.length}\n  winner: P${final.winner}\n  rounds: ${final.round}\n  finalHash: ${finalHash}`,
);
