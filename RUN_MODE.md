# Run mode ("roguelike") — design, as built

## Context

FanSong has one-off matches (vs AI, hotseat, online) and a single-player **run**: draft a small warband, pick a road up a map of battles and safe stops to the boss at its top, improve the warband on the way, and stop when a battle is lost. Scope agreed in the interviews:

| Topic | Decision |
|---|---|
| Difficulty | Bigger enemy point budget, tougher generated rosters, more hostile maps/modes. **No AI changes.** |
| Enemies | Generated from the preset factions' unit pools, bought up to a step's budget |
| Growth | All three, layered after every win: unit XP → the battle's reward → gold |
| Unit growth | Existing engine traits and Quality/Combat steps only. **No engine changes** (the one since: the retreat, see [RETREAT_PLAN.md](RETREAT_PLAN.md)). |
| Attrition | Injury roll for each fallen unit |
| Start | Draft a warband from random offers |
| Structure | A Slay the Spire–style **act map**: 2 acts of 7 steps each (6 branching steps, then the boss). The boss is on show from the start. Beating the second boss = "victory", then endless acts |
| Nodes | Battle, Elite, Market, Camp, Training ground, Mystery, Boss |
| Shops | A small field shop after each battle (mending and one recruit); the full shop only at Market nodes |
| Retreat | Fall back to the map: the fled node closes, another branch is picked |
| Regular modes | Annihilation, conquest, king-of-the-hill |
| Persistence | Resume between any two steps; a battle left midway **restarts** (same seed, same enemy). Local best-run records. Run seed shown and enterable |

The first version of run mode was a flat list of rounds, each a pick of 1 of 3 missions, with a boss every 5th. The map replaced it; what it kept is noted where it matters.

## Shape

**All run rules are a pure, seeded state machine in `packages/content/src/run/`** — same spirit as the engine: `RunState` + a step function, no DOM, tested in Node. The web app only renders it and stores it. The worker and the golden replay are untouched. The engine and protocol were too until retreat banners ([RETREAT_PLAN.md](RETREAT_PLAN.md)), which added one optional piece of engine state: a config may name retreat zones, and only then is the `Retreat` command legal. The map needed no engine change.

### Run state (`run/types.ts`)

```ts
interface RunUnit { id: string; unit: WarbandUnit; xp: number; level: number; kills: number; sitsOut?: boolean; benched?: boolean; wounds?: Wound[] }
interface RouteNode { id: number; step: number; lane: number; kind: NodeKind; next: number[];
  budget?: number; threat?: number; faction?: string; mode?: GameMode; rewardKind?: RewardOption['kind']; rival?: true }
interface Route { act: number; nodes: RouteNode[]; at: number | null; path: number[]; going?: number; closed: number[] }
interface RunState {
  version: 3; seed: number; round: number;          // round = the step along the route about to be / being played
  phase: 'draft' | 'map' | 'briefing' | 'battle' | 'aftermath' | 'reward' | 'shop' | 'stop' | 'over';
  roster: RunUnit[]; gold: number; banners: number;
  rolls: number;                                     // RNG draws spent this step, so rerolls stay seeded
  retreats?: number;                                 // retreats made at this step: re-keys the next battle
  route?: Route;                                     // the act's map (absent only during the draft)
  offer?: ...; pending?: ...;                        // draft / owed reward / shop stock / camp / training / event; level-up choices
  battle?: { map: MapDef; enemy: Warband; elite?: true; plain?: true; ... };  // the node's battle; reused on restart
  log: RoundSummary[];                               // per battle: step, mode, enemy, kills, losses
}
```

**The step is the round.** `RunState.round` is the step along the path (1–7 in act 1, 8–14 in act 2, …), and every node finished, fight or stop, moves it on by one. Everything that was keyed on the old round is keyed on the step: `enemyPoints(round)`, `runTerrain`, `rollMode`, `scheduleRivals` and the RNG streams. Every random choice draws from `seed` via the engine's `seedRng`/`rngNext`, keyed by step + `rolls` (and by act for the route, by step + node + retreats for a battle), so a seed reproduces the whole run's map, offers, enemies and battlefields.

**Built-in risk and reward:** the enemy budget rises every step whether the step was fought or not. A stop is safe now, but skips a battle's XP, gold and reward, so the next fight is relatively harder. A road of nothing but fights has 5 of them and one stop before the boss (the top row is always stops); the safest has 3 fights and 3 stops.

### The map (`run/route.ts`)

`generateRoute(seed, act, rivals)` draws an act from the new stream `RUN_STREAM.route`, keyed by act:

- **Shape:** 5 lanes × 6 rows, the boss above them. Four walks go up from the bottom row, each a step to the lane left, ahead or right, leaning toward ground no walk has trodden and never crossing a road already there; the nodes are the places they pass. Then neighbouring nodes the walks left unjoined get a **side road** (chance `route.sideRoads`, 0.8) where it crosses nothing. Every node of the top row leads to the boss. About 18 nodes an act; a wandering run has a choice of roads on about two steps in three.
- **Kinds:** row 1 is all battles. Row 6 is camps and markets (one of each if it has two nodes). Rows 2–5 are rolled by weight (`route.kinds`: battle 45, mystery 15, elite 15, market 10, camp 8, training 7), but an elite waits no lower than row 3 and **no stop follows a stop** — so row 5, under a row of stops, is all fights. Every act is given an elite and a market if the rolls left it without.
- **What a fight shows:** rolled at generation, and drawn on the map: its **threat** (skulls: a battle's enemy is bought with 75–130% of the step's budget, an elite's with 140–160%, and the skulls count what the warband that buys really costs), its **faction** (a silhouette), its **mode** and the **kind of reward**. The enemy warband, the battlefield and the reward itself are rolled on arrival, for the roster as it stands.
- **Rivals:** a past run's warband, scheduled for a step as before (`run/rivals.ts`), takes a battle node of that step, marked on the map. If that step has no plain battle node (or the road taken misses the one it has), the rival is not met.

`Route.at` is the node last finished, `path` the road taken, `going` the node being played, `closed` the nodes retreated from. `openNodes(route)` is what `at` leads to (the bottom row at an act's start), less the closed.

### Flow

`draft → map → (node) → map → … → boss → next act's map`. On the map the one action is `travel { nodeId }`, legal for the open nodes.

| Node | What happens |
|---|---|
| **Battle** | briefing → battle → aftermath → reward → **field shop** → map |
| **Elite** | The same against a warband at threat 1.4–1.6 that always brings its leader and has veterans from the first step. It pays by the reward formula (about 2.25× a plain battle at 1.5) **plus a free training** (as at a training ground) before the field shop |
| **Boss** | Kill-the-king against a champion on the step's budget +20%; pays twice the usual reward and a retreat banner. Beaten, the next act's map is drawn |
| **Market** | The full shop: 5 recruits, 4 upgrades, heal, reroll, sell, and **a retreat banner for 40 gold** (up to 3 in hand) |
| **Camp** | Pick one: **Rest** (every lasting wound mended, whoever sits out fit again) or **Drill** (every unit +3 XP; a level that brings is spent in camp) |
| **Training** | Name a unit, then take 1 of **3** advances it lacks: free, and it spends no level. The choice of unit is final; the ground may be passed by until a unit is named |
| **Mystery** | One seeded event (below), settled by one choice |

1. **Draft** — pick a leader (1 of 3), then troops (1 of 3, repeated) until the draft budget is spent. Leaders come from `PRESET_UNITS` via `presetUnit` (`presets.ts`); troops from `TROOP_POOL`, the preset troops plus the wild units (see Growth). All costed by `unitCost` (`cost.ts`).
2. **Map** — travel to an open node.
3. **Briefing** — shows the mode, map thumbnail (`ui/mapThumb.ts`), the enemy as silhouettes with a skull rating, and the reward in full. Player may bench units (roster cap 12) and, at the boss, pick their King. The enemy roster is only seen in the battle.
4. **Battle** — ordinary local match: `MatchSetup { warbands: [player, enemy], seats: ['human','ai'], seed, mapId, mode, kings }`.
5. **Aftermath** (win only) — XP, level-ups, injury rolls.
6. **Reward** — claim what the battle promised (a boost or mending asks which unit). If nobody can take it any more, it is paid as gold of the same worth.
7. **Field shop** — mending, and one recruit (`fieldShop` in `RUN_TUNING`); no reroll, no selling, no upgrades. The free `EAGER_CADET` still stands in when the gold in hand buys nobody, so a wiped roster can refill. Then back to the map, a step on. Loss at step 4 → `over`, record saved.

**Retreat** (rules in [RETREAT_PLAN.md](RETREAT_PLAN.md)): a run holds retreat banners (1 at the start, +1 per boss beaten, more from markets and the fallen standard, at most 3). With one in hand the battle's config carries the player's deploy zone as its retreat zone, and the Leader may sound the retreat. The call spends the banner, whoever then wins. A battle lost after it does not end the run: its aftermath has no XP or gold (units left behind roll the harsher `leftBehind` table), there is no reward, and after the field shop the run **falls back to the map at the same step, with the fled node closed**. If that would leave no road open, or the node was the boss, the node stays open and is met again with a new enemy (`RunState.retreats` keys the encounter stream).

### Mystery events (`run/events.ts`)

A mystery node rolls its event on arrival. Each has two ways to take it; a choice is final, the offer then says what came of it (and what die was thrown), and `leaveStop` goes back to the map. The wording is the game's own.

| Event | Choices |
|---|---|
| **The sellsword** | Hire a recruit worth at least 45 points for 60% of its price · walk on |
| **The old shrine** | One unit kneels: it gains a random trait it lacks **and** a random lasting wound · walk on |
| **The ambush** | Fight through: a battle at threat 0.75 for XP and gold but no reward (then the field shop) · pay a toll (10 gold + 3 a step) |
| **The buried cache** | Take the gold that shows (8 + 2 a step) · dig on a d6: 1–2 the cellar falls in (no gold, a unit sits out the next battle), 3–6 three times the gold |
| **The deserters** | Take in a free recruit (worth up to 45 points before the trait) who is **Disloyal** · turn it in for a bounty (6 gold + 2 a step) |
| **The fallen standard** | Raise it: a retreat banner (not with 3 in hand) · sell it for 25 gold |

An ambush fought is a battle at the mystery's own node: fled, it closes that node like any other.

### Difficulty (`run/encounter.ts`)

- **Budget:** `enemyPoints(round)` — a fixed curve of the step, not tied to the player's strength (so upgrades matter) nor to whether the step was fought. Constants in one `RUN_TUNING` object, tuned with the CLI sim below: see **Tuning** for the numbers.
- **Roster:** the node's faction (a `PRESET_ROSTERS` entry → its unit pool), its leader (from `leaderFromRound`; earlier steps meet a leaderless patrol — for a faction with no leader, one without its costliest unit), filled to budget weighted toward that roster's own proportions. Always at least 3 units (`enemy.minUnits`): a budget too small for that buys the faction's cheapest troops and goes over. From `veteranFromRound`, a growing share of the budget is kept back and, with any leftover points, buys "veteran" upgrades (a favorable trait or stat step) on random units. An **elite** brings its leader and veterans however early it is met.
- **Threat:** a battle's `threat` is its enemy's real cost over the step's budget, which the node already shows on the map (`scoutEnemy`: who waits at a node depends on the seed, the step and the node alone); skulls (1–5) are that mapped over the plain battle's range, and an elite and a boss show all five.
- **Boss (the 7th step of each act):** `mode: 'kill-the-king'`; enemy King is a champion — faction leader pushed to Q2/C5+ with stacked traits — plus an escort from the remaining budget.
- **Map:** one per battle, sized for the two warbands. `generateRandomMap` (`mapGen.ts`), seeded per step and node; it already lays objectives for every mode. Size grows with unit count; `TerrainSettings` get denser/rougher by step; later steps use `symmetric: false`. Regular battles roll annihilation / conquest / king-of-the-hill (annihilation only for the first steps).

### Growth (`run/progress.ts`, `run/shop.ts`, `run/stops.ts`)

- **Battle report:** pure `battleReport(replay)` re-runs the commands through `reduce`, collecting `UnitKilled { unitId, byId }` → kills per player unit, who fell.
- **XP:** +1 for fighting, +2 per kill, +1 more for killing a costlier unit. Levels at 6 / 14 / 24 / 36 XP (cap 4). Each level: choose 1 of 2 advances — an existing favorable trait the unit lacks, Combat +1, or Quality −1, within `STAT_BOUNDS` and `statErrors`. A camp's drill is the only XP not earned in battle.
- **Injury (d6 per fallen unit):** 1 dead; 2 lasting wound (Combat −1, Quality +1, or an unfavorable trait); 3 sits out next battle; 4–6 recovers. Fled units return unhurt; a turncoat (Disloyal) is gone.
- **Reward (per battle, its kind shown on the map and all of it in the briefing):** worth `(base + perRound × round) × (1 + slope × (threat − 1))` in gold (floor `min`; a boss pays `boss` times the base), where a recruit is worth its points, a boost its shop price for the roster's median taker, a mending the shop's heal price. The node's kind — recruit, boost, purse, mending — is kept if the roster can take it on arrival (a purse if not), then something of that kind worth about the value is rolled, topped up in gold (or all gold if nothing fits).
- **Gold:** flat per win + per step + share of enemy points killed. **Recruits** (reward and shops) come from `TROOP_POOL`, as the draft's troops do: the preset troops plus the wild units of `run/wild.ts` — every sprite no preset fields (sea creatures left out for now: `SEA_CREATURES`), each built on load from a one-line sketch (rank → Quality/Combat, role → traits, plus traits of its own). **Shops:** recruits at `unitCost` (if the gold in hand buys none of them, a free `EAGER_CADET`, Q4+ C2, is added), upgrades at cost delta × multiplier, heal a wound; a market also rerolls for a price, buys units back and sells banners.

### Web (`apps/web`)

- `game/runStore.ts` — load/save `fansong.run` and `fansong.runRecords`, following `game/armies.ts` (explicit `MapStorage`, untrusted parse, never throws). Saved on every step. A save of another `version` is dropped, so runs from before the map are not resumed.
- `ui/RunScreen.tsx` + `ui/runView.ts` (pure view-model, tested) — draft, briefing, aftermath, reward, shop/market, camp, training, event, game-over/records. Unit cards reuse `ArmyBuilderScreen` / `armyView.ts` pieces.
- `ui/RunMap.tsx` — the map as an SVG drawn from the pure `routeView(s)`: nodes with x/y (the boss on top), roads, each node's state (`here | open | closed | passed | ahead`) and what is known of it (skulls, mode, faction, kind of reward, or what the stop offers). Clicking an open node travels there; a card per open node beside the map says the same and has a button.
- `ui/nodeArt.ts` — each kind of node is drawn with a Wesnoth item or scenery image (a sword, a flaming sword, a merchant's tent, a campfire, a training dummy, a signpost, a dragon statue), vendored by the sprite importer and credited in `public/sprites/CREDITS.md`.
- `App.tsx` — `View` `{ kind: 'run' }`; a `RunHost` that shows `RunScreen` or, in `battle`, a `LocalMatchClient` built with a `MapLookup` that returns the run's generated map. With `?dev=1`, `window.fansongRun` gives `state()` and `step(action)` (and, in a battle, the `client`).
- `MenuScreen.tsx` — "Run" button; shows "Continue run (act, step)" when one is saved; new-run dialog takes an optional seed.
- Mid-battle exit: state stays in `battle`; returning rebuilds the same setup → battle restarts.

### Calibration tool (`tools/cli`)

`pnpm play run --seeds N`: the AI plays the player's seat too, with a greedy auto-picker for draft/reward/shop, and reports how deep runs get, how each step and kind of node went, and how often each kind was visited. `--route safe|balanced|greedy` sets the way up the map (default `balanced`): `safe` takes a stop where there is one and else the weakest enemy; `greedy` the strongest enemy, an elite before anyone; `balanced` the enemy nearest the step's usual strength. At a camp the picker rests if anyone is hurt and drills if not; at a training ground its costliest unit takes the dearest advance; it hires the sellsword and the deserter, leaves the shrine alone, digs for the cache, fights an ambush (a `safe` run pays the toll when it can) and sells the standard; it buys or raises a banner only with `--retreat losing`. Committed, unlike the AI bench.

## Tuning

The target: an AI-piloted run usually dies around steps 5–8 (a human should beat that), and no way up the map clearly beats the others. All numbers are `pnpm play run --seeds 200 --route …` with `--retreat never`.

**As first built** (the plan's first guess: a 120-point draft against 100 enemy points at step 1, +20% a step):

| Route | Mean step | Median | Died at step 1 | Beat boss 1 | Beat step 14 |
|---|---|---|---|---|---|
| safe | 4.3 | 4 | 21% | 12% | 1% |
| balanced | 4.1 | 4 | 19% | 10% | 1% |
| greedy | 3.8 | 3 | 29% | 13% | 2% |

Too deadly, and from the first step: a drafted warband of 2.6 units on average met 3 to 4. Lowering the enemy's first budget alone did not help (at 80, 75, 70 and 60 points step 1 still killed about one run in six): a budget that small is spent on the three cheapest troops `enemy.minUnits` insists on, and a two- or three-unit warband is outnumbered whatever they cost. What moved it was the **size of the drafted warband**.

**Changed** (`RUN_TUNING`):

- `draft.budget` 120 → **150** (3.1 units on average: step 1 goes from 72–82% won to 83–90%).
- `enemy.start` 100 → **80**.
- `enemy.perRound` 0.2 → **0.22**, so the curve still arrives where the plan wanted it: 317 points at boss 1 and 1273 at boss 2 (the plan's ≈358 and ≈1280).
- Node weights and stop values were left as planned (battle 45, mystery 15, elite 15, market 10, camp 8, training 7; drill 3 XP; banner 40 gold; a market of 5 recruits and 4 upgrades): once the opening was fixed, no route policy needed them moved.

**As tuned:**

| Route | Mean step | Median | Died at step 1 | Beat boss 1 | Beat step 14 | Battles won | Roster at boss 1 | Visits a run |
|---|---|---|---|---|---|---|---|---|
| safe | 6.8 | 7 | 10% | 34% | 3% | 80% | 374 pts (64% won) | 3.9 battles, 0.3 elites, 0.7 markets, 0.6 camps, 0.2 trainings, 0.4 mysteries |
| balanced | 6.7 | 7 | 13% | 40% | 2% | 82% | 425 pts (74% won) | 4.3 battles, 0.5 elites, 0.5 markets, 0.5 camps, 0.1 trainings, 0.2 mysteries |
| greedy | 6.5 | 5 | 18% | 37% | 3% | 81% | 468 pts (77% won) | 3.8 battles, 0.8 elites, 0.5 markets, 0.4 camps, 0.1 trainings, 0.2 mysteries |

The three roads come out level, each in its own way, as the plan hoped: `safe` dies least early but meets the first boss with the weakest warband; `greedy` loses the most runs at step 1 and brings the strongest warband to the boss; elites are beaten 60–73% of the time against 85–86% for a plain battle. The boss is where most surviving runs end (11–20% of all runs die at step 7, and the second boss is beaten by about one run in five that reaches it). One of the 600 runs stalled (see Open risks).

The earlier passes, on the first version, set the things the map kept: the fewest units an enemy fields, the leaderless patrols of the first steps, the XP thresholds (6 / 14 / 24 / 36) and the reward formula (base 30, +4 a step, slope 2.5).

## Deviations from the map's plan

- **Side roads.** Four walks alone left a wandering run with a choice of roads on only about two steps in five. The generator also joins neighbouring nodes the walks left unjoined (`route.sideRoads`), and the walks lean toward untrodden ground (`route.spread`); roads still never cross.
- **`Route.path`.** The route also keeps the road taken, so the map can draw it.
- **Shown threat is the real one.** A node keeps the share of the budget its enemy is bought with (`budget`) and shows its real `threat`, read from the enemy that will be met: with small early budgets a warband made up to three units costs more than it was given, and the roll alone would have shown a hard fight as an easy one.
- **Events have two choices each** (the plan allowed two or three), and the fallen standard's "gold at the cap" is its second choice: raising it is simply not possible with three banners in hand.
- **A rival with no battle node at its step is not met** (the plan put every scheduled rival on the map).
- **Tuning moved the draft budget**, which the plan did not list as a lever, and left the stops' numbers alone: see above.
- **`generateEnemy`'s veteran upgrades are priced once per unit** rather than every pass (same enemies, about nine times faster), since drawing a late act's map now builds every enemy on it.

## Verification

- `pnpm test` and `pnpm typecheck`; golden replay unchanged (no engine edits).
- `packages/content/test/run/`: `route.test.ts` (same seed → same route; every node reachable and reaching the boss; no crossing roads; the kind rules over 500 seeds; a random walk of `legalRunActions` over 200 seeds that never gets stuck or throws, retreats included), `stops.test.ts`, `events.test.ts` (each event's each choice), and the older suites moved from missions to the map. `apps/web/test/run.test.ts` covers the view-models and the save format.
- `pnpm play run --seeds 200 --route safe|balanced|greedy`: no crashes, same seed → same result.
- Live (Playwright, per CLAUDE.md): a seeded run → draft → the map with the boss on top → travel → win → field shop → map; reload mid-map (resumes); a market (and a banner bought), a camp (rest, and drill with a level spent), a training ground, an elite (won, then its free training and the field shop), a mystery (a choice and its result; an ambush's briefing); a retreat, and the node shown closed.

## Open risks

- **Battles are swingy, and one loss ends the run.** Measured with the AI in both seats: a 2:1 points edge wins only about 85% of battles (a mirror match is ~45% from the player's seat), so even an easy battle kills about one run in ten. Retreat banners ([RETREAT_PLAN.md](RETREAT_PLAN.md)) are the rule against that; on the map a retreat costs a branch rather than a re-fight, and banners can be bought. What a banner is worth to an AI pilot was last measured before the map (`--retreat losing`: 31% of runs used one, mean depth 3.3 → 3.4 rounds).
- **Stops dodge battles** that each carry a real risk of ending the run. The curve that rises regardless, and the rule that no stop follows a stop, are what keep `safe` from dominating: see **Tuning**.
- Kill-the-king bosses put the player's King at risk too; in the sim most boss losses are the pilot's own King dying, so the boss numbers measure how the AI guards a King more than how hard the boss is.
- **The sim can stall.** With the AI in both seats a battle very occasionally never ends (seen once in 600 runs: five units against two, neither side attacking). The sim counts it as `stalled` and exits 1; it is the AI's stalemate, not the run's, and a human's battle is not affected.
- Battle-restart lets a player retry by closing the tab (accepted trade-off; same seed means same dice for the same moves).
- The save key carries a `version`, so a later format change can drop old runs cleanly (as version 3 did for runs from before the map).
