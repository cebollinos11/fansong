# Run mode ("roguelike") — design and build plan

## Context

FanSong has one-off matches only (vs AI, hotseat, online). The goal is a single-player **run**: draft a small warband, fight the AI in battle after battle on rising difficulty, improve the warband between battles, and stop when a battle is lost. Scope agreed in the interview:

| Topic | Decision |
|---|---|
| Difficulty | Bigger enemy point budget, tougher generated rosters, more hostile maps/modes. **No AI changes.** |
| Enemies | Generated from the preset factions' unit pools, bought up to a round budget |
| Growth | All three, layered after every win: unit XP → the mission's reward → gold shop |
| Unit growth | Existing engine traits and Quality/Combat steps only. **No engine changes** (the one since: the retreat, see [RETREAT_PLAN.md](RETREAT_PLAN.md)). |
| Attrition | Injury roll for each fallen unit |
| Start | Draft a warband from random offers |
| Structure | Each round a choice of 3 missions (harder pays more; enemies shown as silhouettes). Boss every 5th round (kill-the-king vs a champion, no choice). Beating round 10 = "victory", then endless |
| Regular modes | Annihilation, conquest, king-of-the-hill |
| Persistence | Resume between battles; a battle left midway **restarts** (same seed, same enemy). Local best-run records. Run seed shown and enterable |

## Shape

**All run rules are a pure, seeded state machine in `packages/content/src/run/`** — same spirit as the engine: `RunState` + a step function, no DOM, tested in Node. The web app only renders it and stores it. The worker and the golden replay are untouched. The engine and protocol were too until retreat banners ([RETREAT_PLAN.md](RETREAT_PLAN.md)), which added one optional piece of engine state: a config may name retreat zones, and only then is the `Retreat` command legal.

### Run state (`run/types.ts`)

```ts
interface RunUnit { id: string; unit: WarbandUnit; xp: number; level: number; kills: number; sitsOut?: boolean }
interface RunState {
  version: 2; seed: number; round: number;          // round = battle about to be / being fought
  phase: 'draft' | 'mission' | 'briefing' | 'battle' | 'aftermath' | 'reward' | 'shop' | 'over';
  roster: RunUnit[]; gold: number; rolls: number;    // rolls = RNG draws spent, so rerolls stay seeded
  offer?: ...; pending?: ...;                        // current draft/missions/owed reward/shop stock, level-up choices
  battle?: { setup: MatchSetup; map: MapDef; ... };  // the mission picked (enemy, threat, rewards); reused on restart
  log: RoundSummary[];                               // per round: mode, enemy faction, kills, losses
}
```

Every random choice draws from `seed` via the engine's `seedRng`/`rngNext` (wrap as in `mapGen.ts` `makeRandom`), keyed by `round` + `rolls`, so a seed reproduces the whole run's offers, enemies and maps.

### Loop

1. **Draft** — pick a leader (1 of 3), then troops (1 of 3, repeated) until ~120 points are spent. Leaders come from `PRESET_UNITS` via `presetUnit` (`presets.ts`); troops from `TROOP_POOL`, the preset troops plus the wild units (see Growth). All costed by `unitCost` (`cost.ts`).
2. **Mission** — pick 1 of 3 battles (a boss round offers only the boss). All three share the round's mode and map; each has its own enemy, shown as silhouettes with a skull rating, and its own reward, shown in full. The pick is final.
3. **Briefing** — shows the mode, map thumbnail (`ui/mapThumb.ts`), the enemy still as silhouettes, and the reward. Player may bench units (roster cap 12) and, on boss rounds, pick their King. The enemy roster is only seen in the battle.
4. **Battle** — ordinary local match: `MatchSetup { warbands: [player, enemy], seats: ['human','ai'], seed, mapId, mode, kings }`.
5. **Aftermath** (win only) — XP, level-ups, injury rolls.
6. **Reward** — claim what the mission promised (a boost or mending asks which unit). If nobody can take it any more, it is paid as gold of the same worth.
7. **Shop** — spend gold, then next round. Loss at step 4 → `over`, record saved.

**Retreat** (added later; rules in [RETREAT_PLAN.md](RETREAT_PLAN.md)): a run holds retreat banners (1 at the start, +1 per boss beaten, at most 3). With one in hand the battle's config carries the player's deploy zone as its retreat zone, and the Leader may sound the retreat. A battle lost after that call spends the banner instead of ending the run: step 5 is an aftermath with no XP or gold (units left behind roll the harsher `leftBehind` table), step 6 is skipped, and after the shop the **same round** is fought again against missions rolled anew (`RunState.retreats` keys the encounter stream).

### Difficulty (`run/encounter.ts`)

- **Budget:** `enemyPoints(round)` — fixed curve, not tied to the player's strength (so upgrades matter). Constants in one `RUN_TUNING` object; tuned with the CLI sim below. Start at 100 points, ×1.3 each round (compounding), boss rounds +20%; ×1.25 left a human at 405 points facing 304 in round 6. The sim-tuned start was 50% of the draft budget; 100 is from playtest feedback and not yet re-tuned (AI-piloted runs now die around round 4). (The first guess — 90%, +12% a round — killed four runs in ten in round 1 and then let survivors snowball.)
- **Roster:** pick a faction (a `PRESET_ROSTERS` entry → its unit pool), take its leader (from round 3; rounds 1–2 meet a leaderless patrol — for a faction with no leader, one without its costliest unit, which alone used to cause half of all round-1 deaths), fill to budget weighted toward that roster's own proportions. Always at least 3 units (`enemy.minUnits`): a budget too small for that — rounds 1–3 used to meet one or two units — buys the faction's cheapest troops and goes over. From round 4, a growing share of the budget is kept back and, with any leftover points, buys "veteran" upgrades (a favorable trait or stat step) on random units.
- **Missions (`mission` in `RUN_TUNING`):** a regular round rolls 3 enemies of different factions, each on the round's budget times its own roll in 0.75–1.3, sorted easiest first. A mission's `threat` is its enemy's real cost over the round's budget; skulls (1–5) are that mapped over the roll's range. The enemies come from seed + round alone (stream `RUN_STREAM.encounter`); the rewards are rolled for the roster as it stands. A rival takes the first rolled enemy's slot, at its own threat.
- **Boss (every 5th):** `mode: 'kill-the-king'`; enemy King is a champion — faction leader pushed to Q2/C5+ with stacked traits — plus an escort from the remaining budget.
- **Map:** one per round, shared by its missions and sized for the largest enemy. `generateRandomMap` (`mapGen.ts`) seeded per round; it already lays objectives for every mode. Size grows with unit count; `TerrainSettings` get denser/rougher by round; later rounds use `symmetric: false`. Regular rounds roll annihilation / conquest / king-of-the-hill (annihilation only for rounds 1–2).

### Growth (`run/progress.ts`, `run/shop.ts`)

- **Battle report:** pure `battleReport(replay)` re-runs the commands through `reduce`, collecting `UnitKilled { unitId, byId }` → kills per player unit, who fell. (Confirm how `buildMatch` in `deploy.ts` assigns unit ids to map them back to roster entries.)
- **XP:** +1 for fighting, +2 per kill, +1 more for killing a costlier unit. Levels at 6 / 14 / 24 / 36 XP (cap 4; the first pass, 3 / 7 / 12 / 18, levelled a unit on its first kill). Each level: choose 1 of 2 advances — an existing favorable trait the unit lacks, Combat +1, or Quality −1, within `STAT_BOUNDS` and `statErrors`.
- **Injury (d6 per fallen unit):** 1 dead; 2 lasting wound (Combat −1, Quality +1, or an unfavorable trait); 3 sits out next battle; 4–6 recovers. Fled units return unhurt; a turncoat (Disloyal) is gone.
- **Reward (per mission, shown before the pick):** worth `(base + perRound × round) × (1 + slope × (threat − 1))` in gold (floor `min`; a boss pays `boss` times the base), where a recruit is worth its points, a boost its shop price for the roster's median taker, a mending the shop's heal price. Each mission gets a kind — recruit, boost, purse, mending; different kinds across the three where the roster allows — then something of that kind worth about the value, topped up in gold (or all gold if nothing fits). Tuned with the sim (100 seeds per policy) so a threat-1 mission pays about what the old pick-1-of-3 reward gave a greedy picker (base 30, +4 a round; half that starved every policy): always taking the easiest mission dies least early but meets the first boss weak (38% win), always taking the hardest loses 30% of runs in round 1 but is the only policy that beats round 10. All three reach round 3.0–3.5 on average, as before missions (3.4).
- **Gold:** flat per win + per round + share of enemy points killed. **Recruits** (reward and shop) come from `TROOP_POOL`, as the draft's troops do: the preset troops plus the wild units of `run/wild.ts` — every sprite no preset fields (sea creatures left out for now: `SEA_CREATURES`), each built on load from a one-line sketch (rank → Quality/Combat, role → traits, plus traits of its own). **Shop:** 3 recruits (price = `unitCost`; if the gold in hand buys none of them, a free `EAGER_CADET`, Q4+ C2, is added), 2 upgrades (price = cost delta × multiplier), heal a wound, paid reroll, sell a unit.

### Web (`apps/web`)

- `game/runStore.ts` — load/save `fansong.run` and `fansong.runRecords`, following `game/armies.ts` (explicit `MapStorage`, untrusted parse, never throws). Saved on every phase change.
- `ui/RunScreen.tsx` + `ui/runView.ts` (pure view-model, tested) — draft, briefing, aftermath, reward, shop, game-over/records. Unit cards reuse `ArmyBuilderScreen` / `armyView.ts` pieces.
- `App.tsx` — new `View` `{ kind: 'run' }`; a `RunHost` that shows `RunScreen` or, in `battle`, a `LocalMatchClient` built with a `MapLookup` that returns the run's generated map. `GameScreen` gets an optional `onFinished(replay, winner)` used by its game-over panel ("Continue") in place of rematch.
- `MenuScreen.tsx` — "Run" button; shows "Continue run (round N)" when one is saved; new-run dialog takes an optional seed.
- Mid-battle exit: state stays in `battle`; returning rebuilds the same setup → battle restarts.

### Calibration tool (`tools/cli`)

`pnpm play run --seeds N`: the AI plays the player's seat too, with a greedy auto-picker for draft/reward/shop and a fixed mission policy (`--mission easy|middle|hard`, default easy), and reports how deep runs get. Used to set `RUN_TUNING` so an AI-piloted run usually dies around rounds 4–7 (a human should beat that). Committed, unlike the AI bench.

## Milestones

1. **Core** — `run/` types, RNG, draft, encounter generator, battle report, XP, injuries, rewards, shop; exported from `content/src/index.ts`; unit tests (determinism by seed, every generated warband passes `validateArmy`, every generated map passes `validateMap`, budgets respected).
2. **CLI sim** — auto-picker + `run` subcommand; first tuning pass.
3. **Playable loop** — menu entry, draft, briefing, battle, win/lose, save/resume, records, seed entry.
4. **Between-battle screens** — aftermath (XP, level-up choice, injuries), reward pick, shop.
5. **Bosses and polish** — champion generation, King pick, hostile-map ramp, round-10 victory screen, second tuning pass. README section + PLAN.md milestone.

## Verification

- `pnpm test` and `pnpm typecheck`; golden replay must stay unchanged (no engine edits).
- `pnpm play run --seeds 200`: no crashes, depth distribution sane, same seed → same result. With `--retreat never` (the default) the numbers are those from before retreat banners.
- Live (Playwright, per CLAUDE.md): start a run with a fixed seed, draft, win round 1 (drive via `window.fansong` or play), check aftermath → reward → shop → round 2; reload mid-shop (resumes) and mid-battle (restarts same battle); lose and see the record.

## Open risks

- **Battles are swingy, and one loss ends the run.** Measured with the AI in both seats: a 2:1 points edge wins only about 85% of battles (a mirror match is ~45% from the player's seat), so even an easy round kills about one run in ten. First-pass sim (100 seeds): median death in round 5, a quarter of AI-piloted runs beat round 10, the first boss kills one run in six. If that feels unfair in play, the fix is a rule (a second life, a retreat), not more tuning. **That rule is now in: retreat banners** ([RETREAT_PLAN.md](RETREAT_PLAN.md)). Measured with `--retreat losing` over 200 seeds, though, one banner barely helps an AI pilot: sounding the retreat under 75% of the enemy's living points, 31% of runs used a banner and 28 of those 62 went on to win the round they fled, but the median run still dies in round 3 (mean 3.3 → 3.4) and round 1 still kills one run in five; at 100% it is 56% of runs, mean 3.6, median still 3. Round 10 stays rare (1% or less). The pilot cannot call it once its Leader is dead or down, re-fights the round a unit or two short, and often loses it again. Whether a human, who picks the moment, gets more out of a banner is for playtests; `banners.start` was left at 1.
- Kill-the-king bosses put the player's King at risk too; AI already plays that mode, but balance needs the sim. Second pass (200 seeds): every boss loss in the sim is the pilot's own King dying, and neither dropping the boss bonus nor a Quality 3 champion moves the first boss's win rate out of the noise (70% → 73% / 75%). The sim measures how the AI guards a King, not how hard the boss is, so the boss numbers were left alone pending human playtests.
- Battle-restart lets a player retry by closing the tab (accepted trade-off; same seed means same dice for the same moves).
- Shipping a new save key: `version` field so a later format change can drop old runs cleanly.
