# Forced surrender plan

A lost annihilation battle should not have to be played out. At the start of a round, a side that is far enough behind on points surrenders and the other side wins.

Status: implemented, with the defaults of the three open questions below. See "As built" at the end for where it differs from this plan.

## The rule

Checked once per round, as the new round begins. Side L surrenders to side W when both hold:

1. L's living points are at most **30%** of the points L started with.
2. W's living points are at least **3×** L's living points.

- "Living points" is the summed point cost of a side's units that are not `dead`, counted by current owner. A unit that changed sides counts for its new side; a knocked-down or transfixed unit counts in full.
- Starting points are fixed at setup and never change.
- A side that has sounded the retreat, or still can (`canRetreat`-style: it has retreat zones, a living Leader, and no retreat called yet), is never forced to surrender. It can still win by the other side's surrender.
- The game ends with a new reason, `'surrender'`.

The rule is on for annihilation games only. Objective modes (king of the hill, conquest, capture the flag, kill the king, golden Pig) never use it: a side far behind on points can still win them.

## Why 30% and 3×

Measured on 714 AI-vs-AI annihilation games (every built-in map, presets within 20% of each other's cost, seed 1). At each round boundary every candidate threshold was tested; a call is "wrong" when the side that would have surrendered went on to win.

| Own points ≤ | Winner ≥ | Fires in | Wrong calls | Rounds saved per game |
|---|---|---|---|---|
| 15% | 5× | 22% of games | 1 of 154 (0.6%) | 0.43 |
| 25% | 4× | 34% | 3 of 243 (1.2%) | 0.76 |
| **30%** | **3×** | **51%** | **5 of 366 (1.4%)** | **1.28** |
| 40% | 3× | 53% | 7 of 381 (1.8%) | 1.38 |
| 30% | 2× | 63% | 23 of 450 (5.1%) | 1.78 |
| 50% | 1.5× | 84% | 64 of 597 (10.7%) | 3.40 |

- Below 3× the wrong calls jump to 4–10%.
- Above 30% the own-start limit changes little, but it is kept so that a battle that starts uneven (a run battle with a tight point limit) does not end early on the ratio alone.
- A mean game was 9.1 rounds, so the rule saves about 9% of commands.
- The sample is small (single-digit wrong counts) and AI-vs-AI only. The numbers live in one constant so they are easy to retune.

The measuring script was a throwaway and is not in the repo. To re-measure, play games with the rule off and record living points per side at every `RoundEnded`.

## Design

The engine has no point costs: `unitCost` lives in `packages/content/src/cost.ts`, and the engine cannot import content. So content stamps each unit's cost into the config, and the engine only sums and compares.

Everything is optional state. A config without `surrender` builds exactly the state it builds today, so old replays load and hash unchanged and the `Replay` version does not change.

### Engine (`packages/engine`)

- `types.ts`
  - `Unit.points?: number`, omitted when the rule is off.
  - `GameState.surrender?: { ownShare: number; ratio: number; start: [number, number] }`.
  - `GameOverReason` gains `'surrender'`.
- `setup.ts`
  - `UnitSpec.points?: number`.
  - `GameConfig.surrender?: { ownShare: number; ratio: number }`.
  - `createGame`: when `config.surrender` is set, copy each spec's `points` onto its unit (throw if any is missing or not a positive number), sum `start`, and set `state.surrender`. When it is not set, ignore `points` entirely.
- New `surrender.ts` (or in `mode.ts` beside `checkRoundLimit`)
  - `DEFAULT_SURRENDER = { ownShare: 0.3, ratio: 3 }`.
  - `livingPoints(state): [number, number]`.
  - `surrenderingSide(state): Owner | undefined`, the pure rule including the retreat exemption. Exported so the HUD can warn without re-deriving it.
  - `checkSurrender(s, events): boolean`, which calls `finishGame(s, events, winner, 'surrender')`.
- `reduce.ts`: call `checkSurrender` at the end of `endRound` (line 1551), after the `RoundEnded` event and the Reassembling stand-ups. It runs only if `scoreZones` and `checkRoundLimit` did not already end the game.
- `mode.ts` `finishGame`: always name the reason in the `GameOver` event when it is `'surrender'` (as it already does for `'roundLimit'` and `'retreat'`).
- `index.ts`: export the new names.

### Content (`packages/content`)

- `deploy.ts`: `MatchOptions.surrender?: false` opts out. `buildMatch` (line 266) turns the rule on when the mode is annihilation and it is not opted out: it sets `config.surrender = DEFAULT_SURRENDER` and has `toSpec` (line 110) stamp `points: unitCost(unit)`. In every other case the config is byte-identical to today's.
- `match.ts`: pass the option through `MatchSetup` / `configFromSetup` if a caller needs to opt out.
- Run mode
  - `run/run.ts` `runBattleConfig`: annihilation battles go through the same path, so they get the rule. Boss battles are kill-the-king and do not. Confirm the config is still built in one place, because `settle` compares `JSON.stringify` of the replay's config with `runBattleConfig(s)`.
  - `run/report.ts` `battleReport`: when the game ended by `'surrender'` and the player won, count the surviving enemy points as killed in `enemyPointsKilled`, so a surrender pays what finishing them off would have. No unit gets kill credit for them. Check how `enemyPointsKilled` feeds XP and gold in `run/progress.ts` before settling this.
  - A player forced to surrender loses the battle and the run, as any other loss does. With a banner in hand the player has retreat zones, so the exemption applies and the retreat stays available.
  - Re-run `pnpm play run --seeds 200` before and after, and compare how deep runs get. Won battles end earlier with fewer injuries, so `RUN_TUNING` may need a nudge. Record the result in `RUN_MODE.md`.

### Protocol (`packages/protocol/src/schema.ts`)

- Unit schema (near line 224): optional `points`.
- Unit spec schema: optional `points`.
- Config and state schemas (near lines 285, 575, 675): optional `surrender`.
- `GameOver` reason enum (line 493): add `'surrender'`.

The worker needs no rule code: rooms run the engine. Check that it builds its config through content's `buildMatch` so online games get the rule.

### Web (`apps/web`)

- `src/ui/log.ts` `GAME_OVER_REASONS` (line 148): `surrender: 'forced surrender'`.
- Game-over screen: say "Forced surrender" with the points on each side.
- `src/ui/hudView.ts` (line 68, beside the rout warning): warn when `surrenderingSide` already names a side mid-round, e.g. "surrenders at the end of the round unless it recovers", and show each side's living points.
- `src/three/BoardView.ts` (`GameOver` handling, line 2061): the surrendering side's survivors lower their arms or leave, as a retreat's stragglers do. Reuse what exists; keep it small.
- `src/game/effectDemos.ts`: add an Animations demo for the surrender ending.
- Sound: reuse the `victory` / `defeat` cues. Add a dedicated cue only if asked.

### CLI (`tools/cli`)

- `format.ts` already prints the reason. Nothing else is required.
- `bench` self-play must still report 50.0% in annihilation.

### AI (`packages/ai`)

No change. The AI could later learn to protect points near the threshold; that is a separate change, measured per CLAUDE.md.

## Tests

- `packages/engine/test/surrender.test.ts`
  - Fires at a round boundary when both conditions hold, with a `GameOver` event carrying `reason: 'surrender'`.
  - Does not fire mid-round, however lopsided.
  - Does not fire when only one condition holds (each way).
  - A config without `surrender` never fires and builds the same state as before (no `points`, no `surrender` key).
  - A side that has called the retreat, or still can, is not forced.
  - A defector's points count for its new side.
  - The round limit and zone scoring take precedence at the same boundary.
- `packages/content/test`: `buildMatch` stamps points and the rule for annihilation only, and `surrender: false` leaves the config as it was; `battleReport` on a surrender win.
- `packages/protocol/test`: the new fields round-trip.
- Re-bless the golden fixture (`pnpm --filter @fansong/cli gen:golden`) if its game is annihilation built through content: the change is intended.
- `pnpm test` and `pnpm typecheck` pass.
- Live check per CLAUDE.md: in the dev sandbox, stage a lopsided annihilation game, end the round, and see the surrender ending, the log line and the HUD warning.

## Docs

- `README.md`: the rule, in the game's own wording.
- `RUN_MODE.md`: how a surrender settles in a run, and the calibration numbers.
- `PLAN.md`: note it under the right milestone.
- `CLAUDE.md`: one line, only if something here is a gotcha for later work.

## Open questions

1. **A setup toggle.** The plan has the rule always on in annihilation, with a code-level opt-out only. Add a checkbox to the match setup screen if players should be able to switch it off.
2. **Run rewards.** The plan pays a surrender as if the survivors were killed, with no per-unit kill credit. The alternative is to pay only for real kills, which would push players to avoid triggering the rule.
3. **Thresholds per context.** One pair of numbers for everything. A run could use stricter ones if forced losses there feel unfair.

## As built

- **`surrenderedSide(state)`** was added to the engine beside `surrenderingSide`. A finished state keeps no reason for its ending, and the game-over screen needs one: only a surrender ends a game at the top of a round, with nobody activated and both sides on the field.
- **The opt-out stops at `MatchOptions.surrender: false`.** `MatchSetup` has no such field, since nothing needed it and there is no setup toggle.
- **Run rewards: gold in full, kill XP shared out.** `enemyPointsKilled` only feeds gold (`goldFor`); XP comes from each unit's own `kills` and `killCosts`, so the plan's default paid no XP for the survivors. Added afterwards: each survivor is worth `xp.perKill`, split evenly among the units that fought and did not turn (`surrenderShares`). Still no kill credit, and no `costlierKill` bonus.
- **The golden fixture was not re-blessed.** It is a raw `GameConfig`, not one built by content, so it has no rule and its hash is unchanged.
- **The dev sandbox keeps the points honest**: a spawned unit is priced and added to its side's starting points, a removed one taken off, and the effect demos stage their scenes without the rule (the *Forced surrender* demo sets it itself).
- **Tests that assumed annihilation ends with one side wiped out** (`selfPlay/harness.ts`, `tools/cli/test/preset-match.test.ts`) now accept a forced surrender too.
- **Run depth did not move** (200 seeds: mean step 4.9 before, 5.0 after), so `RUN_TUNING` is unchanged. Numbers in RUN_MODE.md.
