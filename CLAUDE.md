# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

FanSong is a fan, rules-compatible *Song of Blades and Heroes*–style skirmish wargame with a "you go, I go" activation twist. [README.md](README.md) describes the rules as implemented; [PLAN.md](PLAN.md) holds the design and milestones (M0–M7 done, M8 in progress); [RULES_GAP.md](RULES_GAP.md) tracks the original rules not yet implemented.

## Commands

pnpm monorepo (`packages/*`, `tools/*`, `apps/*`), Node >= 20. There is no linter; `pnpm typecheck` is the static check.

```bash
pnpm test                                   # all Vitest suites (root vitest.config.ts)
pnpm vitest run packages/engine/test/combat.test.ts   # one file
pnpm vitest run -t "turnover"               # tests whose name matches
pnpm typecheck                              # tsc --noEmit in every package
pnpm play --help                            # headless AI-vs-AI runner (tools/cli)
pnpm --filter @fansong/cli gen:golden       # re-bless the golden replay fixture
pnpm --filter @fansong/web dev              # web UI at http://localhost:5173
pnpm --filter @fansong/worker dev           # local Worker at http://localhost:8787
```

Tests live in each package's `test/` directory (`**/test/**/*.test.ts`) and run in a Node environment, including the web app's tests, which have no DOM.

## Architecture

**The engine is the whole game.** `packages/engine` is a pure, deterministic TypeScript state machine with no rendering, React or Cloudflare dependencies:
- `reduce(state, command) -> { state, events }` applies every rule.
- `getLegalCommands(state)` lists every legal action. The AI, the tests, the CLI and the UI all choose from this list, so no client ever reimplements legality.
- The seeded RNG lives *in* `GameState`, so a game is fully determined by `seed + command list`. A `Replay` is `GameConfig + commands`. `runReplay` + `hashGameState` + a committed golden fixture catch accidental rule changes. If a rule change is intended, re-bless the fixture with `gen:golden`; bump the `Replay` version when old replays can no longer load.
- All geometry (distance, adjacency, range, line of sight) goes through the `Board` interface in `board.ts`, on a flat-top hex grid.
- Terrain, maps and game modes are optional state: the default flat annihilation game is unchanged when they're absent.

**Everything else is a client of the engine:**
- `packages/ai`: `chooseCommand`, a deterministic heuristic that is both the vs-AI opponent and the test bot.
- `packages/content`: point-buy costing, warband validation, preset warbands, the map format and `validateMap`, built-in `maps/*.json`, the map-editor model, and match building (`buildMatch`, `createMatchFromPresets`).
- `packages/protocol`: zod wire schemas. They are the trust boundary between client and server.
- `apps/worker`: Cloudflare Worker + Durable Objects. Rooms are authoritative, joined by code, and synced over WebSocket.
- `apps/web`: Vite + React + three.js. A `MatchController` (`src/game/controller.ts`) checks every command against `getLegalCommands` before calling `reduce`. Local, vs-AI, online (`OnlineMatchClient`) and dev-sandbox play all sit behind the same client seam. The board (`src/three/`) only projects legal commands into highlights and animates from state and events.

**IP rule:** use original wording for rules text and original unit profiles and names. Never copy rulebook text, stat profiles or trademarked names (see the IP note in PLAN.md). Unit and terrain art is vendored from Battle for Wesnoth (GPL-2.0+, credited in `apps/web/public/sprites/CREDITS.md`).

## Workflows and gotchas

**Never copy `node_modules` into a git worktree or any other copy of the repo, and never `git worktree remove --force` one that has it.** pnpm's `node_modules/@fansong/*` entries are Windows junctions pointing at the real `packages/*`, and deleting the copy follows them. This once wiped `packages/engine`, `ai` and `content`, including uncommitted work. To compare against HEAD, stash or save a patch; in a fresh worktree, run `pnpm install --offline` instead. Recovery: `git restore packages/`, move `node_modules/.pnpm-workspace-state-v1.json` and `node_modules/.pnpm/lock.yaml` aside, then run `pnpm install --offline --frozen-lockfile`. A plain `pnpm install --force` does nothing.

**Verifying UI changes live.** Run the web dev server and drive it with Playwright. On this machine Playwright is installed globally, and ESM must import it by absolute URL: `file:///C:/Users/cebol/AppData/Roaming/npm/node_modules/playwright/index.mjs`. With `headless: false` it renders on the real GPU. Headless needs `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, or the three.js board renders blank.
- The board is a single canvas picked by raycast, so units have no DOM handle. To set up a scenario, use the dev sandbox instead of clicking: open `http://localhost:5173/?dev=1&sandbox` and script it through `window.fansong` (`fansong.edit(s => fansong.ops.spawnUnit(s, 0, profile, {x,y}))`, `ops.activateUnit`, `ops.clearUnits`, `fansong.client.send(cmd)`, `fansong.state()`, `fansong.demo('supported')` to play an Animations demo).
- The sandbox panel's **Animations** section has one button per melee outcome, shooting outcome and trait; each stages a small scene and plays it (`src/game/effectDemos.ts`). Add a demo there when an outcome or trait gets a new effect.
- `?animSpeed=0.25` slows animations so screenshots catch them. The console 404 on `/favicon.ico` is expected.

**Sound effects** are the user's own mouth recordings. `apps/web/src/audio/sfxCues.ts` is the one list of cues; `BoardView.sound(name)` plays one beside the visual effect it belongs to, and a cue with no recording is silent (or plays its `fallback`). To add a sound, add a cue there and call `this.sound(...)`; the user records it in the booth at `http://localhost:5173/?dev=1&record`, which saves the takes to `apps/web/public/sfx/` and rewrites `manifest.json` through a dev-server endpoint in `vite.config.ts`. Commit the WAVs and the manifest. The sandbox's **Sounds** section lists every cue with whether it is recorded.

**Unit sprites and terrain art** are imported from a local Wesnoth checkout (`C:\Repos\wesnoth`), not fetched. To add or change a unit's sprite:
1. Edit `UNIT_SPRITES` in `apps/web/src/three/unitSprites.ts`.
2. Run `pnpm --filter @fansong/web sprites C:\Repos\wesnoth`. This parses the WML into `src/three/unitAnimations.json` and copies the frames into `public/sprites/`.
3. Commit the JSON and the PNGs, so the game builds without Wesnoth.

For units Wesnoth gives no `move` clip, `pnpm --filter @fansong/web walks` synthesizes walk cycles from the hand-tuned `RIGS`. Keep new art in Wesnoth's pixel-art style: vendor raw Wesnoth images and compose them at runtime rather than committing baked composites.

**Changing the AI.** Measure the change by win rate against the previous AI, not by eye:
1. Freeze the old AI in a temporary `packages/ai/src/baseline.ts` (from `git show HEAD:...`; never commit it).
2. Play new vs baseline with a throwaway `tools/cli/src/bench.ts` via `createMatchFromPresets`, per mode across maps, presets and seeds, with both seat orders on the same seed. Identical bots then score exactly 50%.
3. At about 800 games per mode the margin is ±3.4%, so treat differences under ~4% as noise.

Also check decision time on the 40×40 `stone-crown` map.

**Preset exports:** when handed a `fansong-presets.json` from the dev preset editor, use the `apply-presets` skill.

**Commit messages:** write the subject as a plain-English imperative sentence that says what changed for the player (e.g. "Pan the camera with WASD, and move the war cry key to C"). Add a body paragraph when the reasoning isn't obvious.
