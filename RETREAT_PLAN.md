# Retreat banners — design and build plan

Follow-up to [RUN_MODE.md](RUN_MODE.md). Today one lost battle ends a run, and battles are swingy (a 2:1 points edge still loses about 15%). A **retreat banner** lets the player give a battle up and keep the run, at the cost of whoever does not get off the field.

## Rules

| Topic | Decision |
|---|---|
| Banners | A run starts with **1**. Sounding the retreat spends one, even if the battle is then won. More are gained later (see Assumptions). |
| Who calls it | The player's **Leader**, as an action of its own activation, like the war cry. Once per battle. Needs a banner in hand. |
| Guard | A confirm panel before the command is sent. |
| The flag | On the call, **one empty hex of the player's deploy zone** becomes the retreat hex. It shows a flag (the capture-the-flag one) and the camera pans to it. |
| Leaving | A friendly unit that **ends a Move on the flag hex** leaves the field, unhurt. |
| The Leader leaves | The battle ends at once, lost. Every friendly unit still on the field is **left behind**. |
| Left behind | Rolls the injury d6 like a fallen unit, with **two more faces of death**: 1–3 dead, 4 wound, 5 sits out, 6 recovers. |
| Killed during the retreat | The ordinary injury roll (1 dead, 2 wound, 3 sits out, 4–6 recovers). |
| After a retreat | No XP, no gold, no mission reward. The run goes on at the **same round**, with new missions. |
| No retreat called | A lost battle ends the run, as today. |

### Assumptions (not settled with the user — check before or while building)

1. **Fighting on.** Calling the retreat restricts nothing: units may still attack, shoot and cast, so a rearguard can cover the others. (Simplest rule, and it matches what was described.)
2. **The Leader dies after the call.** The flag stays and the others may still walk off. The battle then ends by its ordinary rules (nobody left, score, King slain); units still on the field at that point are left behind. The banner is spent and the run goes on if any roster unit lives.
3. **Gaining banners.** +1 for each boss beaten, up to `RUN_TUNING.banners.max` (3). No shop item yet.
4. **Which hex.** No dice: the empty, passable deploy-zone hex farthest from the nearest enemy; ties go to the one nearest the Leader, then to scan order. An enemy that later stands on it blocks it (the AI does not seek it out).
5. **Cost.** One action, like the war cry. A knocked-down Leader cannot call it.
6. **Boss rounds.** Allowed. A King that walks off the flag does not count as slain.
7. **Enemy.** Never retreats: its side gets no retreat zone.
8. **Left-behind units earn nothing and keep their wounds' ordinary rules** (a wound with nothing left to wound becomes "sits out", as today).

## Shape

Unlike the rest of run mode, this needs an engine change. It is **optional state**: a config without retreat zones never offers the command, so the default game, every existing replay and the golden fixture are unchanged. `REPLAY_VERSION` stays 2 (old replays still load).

### Engine (`packages/engine`)

- `setup.ts` — `GameConfig.retreatZones?: [Vec[], Vec[]]`: the hexes each player's retreat flag may be planted on; empty or absent means that player cannot retreat. Copied onto `GameState` only when present.
- `types.ts`
  - `RetreatCommand { type: 'Retreat'; unitId: string }` in `Command`.
  - `GameState.retreat?: { owner: Owner; hex: Vec }` — set by the call, never cleared.
  - `Unit.retreated?: true` — left by the flag. Such a unit is also `dead` (so every "living unit" query drops it) but is not a casualty.
  - Events: `RetreatCalled { unitId; hex }`, `UnitRetreated { unitId; at }`.
  - `GameOverReason` gains `'retreat'`.
- `query.ts` — `canRetreat(state, unit)`: a living Leader on its feet, its side has a non-empty retreat zone with a free hex, no retreat called yet. `retreatHex(state, leader, board)`: assumption 4.
- `legal.ts` — beside the war cry: `if (canRetreat(state, unit)) commands.push({ type: 'Retreat', unitId })`. (Being the active unit with an action left is already checked above it.)
- `reduce.ts`
  - `handleRetreat`: validate, spend an action, set `s.retreat`, emit `RetreatCalled`.
  - In the Move handler, after the move resolves (flags, contact): if `s.retreat?.owner === unit.owner` and the unit stands on `s.retreat.hex`, mark it `dead` + `retreated`, emit `UnitRetreated`, end its activation. **No morale checks, no kill credit.** If it was the Leader: `finishGame(s, events, other(owner), 'retreat')`. Only a `Move` does this, not a push, recoil or flight.
  - `checkGameOver` already ends the game when a side has no living unit; make that `'retreat'` rather than `'annihilation'` when the emptied side had called one. `finishGame` must emit the reason for `'retreat'` even in annihilation (it drops the reason outside objective modes today).
- `mode.ts` — `fallenKingOwner` skips `retreated` units (assumption 6). Check `routThreshold` / `livingCount`-based morale in `morale.ts`: a unit leaving by the flag must not count as a loss toward the rout check.
- `apply.ts`, `plan.ts` — add the command to the equality switch and the plan chains (it ends nothing; treat like `WarCry`).
- Tests (`packages/engine/test/retreat.test.ts`): not legal without zones / without a Leader / twice; hex choice is deterministic; a unit ending a move on the hex leaves and triggers no nerve checks; the Leader leaving ends the game with winner = enemy and reason `'retreat'`; a pushed unit does not leave; the golden replay hash is unchanged.

### Protocol, AI, CLI

- `packages/protocol/src/schema.ts` — command and event schemas (online rooms never set retreat zones, but the unions must stay exhaustive).
- `packages/ai/src/index.ts` — both `switch (command.type)` scorers: `Retreat` scores below everything (never chosen). The AI must still **pursue**: confirm in conquest and king-of-the-hill that it does not just sit on zones while the player walks off; no change expected, no bench needed if the AI's choices in games without a retreat are byte-identical (assert with the existing golden replay).
- `tools/cli/src/format.ts` — print the command and events.

### Run rules (`packages/content/src/run`)

- `types.ts`
  - `RunState.banners: number`; `RunState.retreats?: number` (retreats made this round, for the mission re-roll).
  - `UnitFate` gains `'retreated'` (left by the flag) and `'leftBehind'`.
  - `BattleReport.retreated: boolean`; `RoundSummary.retreated?: true`; `Aftermath.retreated?: true`.
  - `RunState.version` → 3, or keep 2 and read a missing `banners` as 1 — pick whichever `runStore.ts` makes cleaner (it rejects `version !== 2` today).
- `tuning.ts` — `banners: { start: 1, max: 3, perBoss: 1 }`, `leftBehind: { dead: 3, wound: 4, sitsOut: 5 }`.
- `run.ts`
  - `runBattleConfig`: when `s.banners > 0`, add `retreatZones: [map.deployZones[0], []]`. The config must be the same on every call during the battle, so spend the banner in `battleResult`, not before.
  - `battleResult`: three branches now — won (as today, plus the boss banner), **retreated** (`report.winner === 1 && report.retreated`), lost (run over).
  - Retreated: `applyRetreat(s, report, roll(s))`, `banners--`, `retreats++`, phase `aftermath` with no reward owed; `continue` then goes to the **shop** (so losses can be replaced with gold in hand) and `leaveShop` re-enters `mission` **without** `round++`. If the roster is empty, phase `over`.
  - `leaveShop` after a win resets `retreats`.
- `encounter.ts` — missions come from `makeRunRandom(seed, round, 0, RUN_STREAM.encounter)`: pass `retreats` where the `0` is, so a replayed round meets new enemies while a seed still reproduces the run.
- `report.ts` — `retreated` = the final state has `retreat.owner === 0`. Fates: `UnitRetreated` → `'retreated'`; in a retreated battle, a player unit still `'survived'` at the end → `'leftBehind'`.
- `progress.ts` — `applyRetreat`: no XP or gold; `'fell'` rolls `injuryFor`, `'leftBehind'` rolls the harsher table (factor the wound/dead/sits-out body out of `applyAftermath` and share it); log the round with `won: false, retreated: true`. `injuryFor(die, table = RUN_TUNING.injury)`.
- Tests: banner spent only by a retreat; retreat keeps the round and re-rolls missions; left-behind table; `'retreated'` units untouched; no banner → no retreat zones in the config; boss win adds a banner up to the cap; a seed still reproduces a run with a retreat in it.

### Web (`apps/web`)

- `game/interaction.ts` — `canRetreat`, from the legal commands, as `canWarCry` is.
- `ui/Hud.tsx`, `ui/GameScreen.tsx` — a **Retreat** button beside the war cry (key `R` if free), opening a confirm panel ("Sound the retreat? This battle is lost. Units that reach the flag leave unhurt; any still on the field when your Leader leaves may not come back."). Confirm sends the command. The game-over panel reads "Retreated" for reason `'retreat'`.
- `three/BoardView.ts`
  - `RetreatCalled`: plant the capture-the-flag flag on the hex, highlight it, pan the camera to it (see `focusUnits` / `panToSelected`), play a horn. The flag is drawn from `state.retreat` so a reload shows it.
  - `UnitRetreated`: the unit steps off and fades; no death animation.
  - Game over by `'retreat'` with units left: they run for the flag / home edge and fade, off camera. Visual only — their fate is rolled in the aftermath.
- `ui/log.ts`, `ui/SandboxScreen.tsx`, `game/planRunner.ts` — the new command and events in their switches.
- `audio/sfxCues.ts` — cues `retreat-horn` and `unit-retreats`, each with a `fallback`; a scene for each in `game/soundScenes.ts`; a `retreat` demo in `game/effectDemos.ts` (sandbox Animations section).
- `ui/RunScreen.tsx`, `ui/runView.ts` — banner count on the run header and briefing; a retreat aftermath (fates `retreated` / `leftBehind`, the die and its harsher table shown, no XP column); records show a retreated round.
- `game/runStore.ts` — the new fields, parsed as untrusted.

### Calibration (`tools/cli/src/runSim.ts`)

A pilot policy `--retreat never|losing` (default `never`, so today's numbers stand). `losing`: the Leader calls it when its side's living points fall under a share of the enemy's, then every unit walks for the flag. Report how many runs a banner saved and how many units were left behind. Use it to check that `banners.start: 1` moves the median death round without making round 10 routine.

## Milestones

1. **Engine** — command, state, events, win reason, tests; golden hash unchanged.
2. **Run rules** — banners, report, `applyRetreat`, mission re-roll, tests.
3. **Clients** — protocol, AI and CLI switches; `pnpm typecheck` clean.
4. **Web** — button and confirm, flag and camera, leave animation, aftermath screen, banner count, sounds, demo.
5. **Sim and docs** — retreat policy, a tuning pass; update README.md, RUN_MODE.md (the "no engine changes" line and the Open risks entry), PLAN.md.

## Verification

- `pnpm test`, `pnpm typecheck`; the golden replay fixture is **not** re-blessed.
- `pnpm play run --seeds 200` with `--retreat never` gives the numbers it gave before the change.
- Live (Playwright, per CLAUDE.md): in the sandbox, stage a Leader and two troops with retreat zones, call the retreat, check the confirm panel, the flag and the camera pan; walk one troop off; walk the Leader off; the game ends "Retreated". In a run: retreat in round 1, see the aftermath dice, the banner at 0, the same round with new missions; reload mid-battle after the call (the battle restarts, banner still in hand).
