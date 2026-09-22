# FanSong — Development Plan

A fan, rules-compatible web implementation of a *Song of Blade and Heroes*–style
skirmish wargame, with a twist on activation: instead of one player activating
all their units and then the opponent activating all of theirs, play alternates
**one unit at a time** ("you go, I go") until a turnover benches a player for the
round.

> **IP note:** Game *mechanics* are not copyrightable, so a rules-compatible
> engine is fine. This project uses **original wording** for all rules text,
> **original unit profiles/content**, and generic (non-trademarked) names and
> art. No rulebook text, stat profiles, or trademarked names/art are copied.

---

## 1. Decisions locked in

| Area | Decision |
|------|----------|
| Space model | **Flat-top hex grid** (M6; behind a `Board` interface — was a square grid through M5) |
| MVP scope | **Core loop first** — activation, the alternating turnover twist, movement, opposed combat, kill/knockdown, minimal morale |
| AI opponent | **Heuristic only** (pure, deterministic; doubles as the test bot) |
| Content | **Point-buy builder + a few original preset warbands** |
| Initiative | **Alternate each round** — whoever went second last round leads next |
| Terrain & modes | **Sparse, optional** per-hex elevation/features and objective modes (M7) — the default flat annihilation game is unchanged |

---

## 2. Guiding principle: headless engine, disposable UI

Everything flows from the requirement that an AI coding agent can play the game
for tests. The game is a **pure, deterministic TypeScript state machine** with
zero rendering dependencies. Three.js, React, Cloudflare, and the AI are all
*clients* of that engine. Pure engine + seeded RNG ⇒ any AI/test can play a full
game by calling functions — no browser, no 3D, no network — with byte-identical
results every run.

```
GameState + Command  ──reduce──▶  GameState' + Events
        ▲                                  │
        └──────── seeded RNG (in state) ───┘
```

- **`reduce(state, command) → { state, events }`** — the whole game; pure function.
- **`getLegalCommands(state) → Command[]`** — enumerates every legal action for
  the active player. AI, tests, and the hotseat UI all pick from this list.
- **Seeded deterministic RNG** stored *in* the state, so dice replay exactly.
  Replays = seed + command list.

---

## 3. Monorepo layout

```
fansong/
├─ packages/
│  ├─ engine/     # pure TS: state, commands, rules, RNG, legal-move gen. No three/react/cloudflare deps
│  ├─ ai/         # heuristic opponent; imports engine only
│  ├─ content/    # warband builder, point costs, preset warbands, maps + map validation (M7)
│  └─ protocol/   # shared wire types (zod) for client <-> Durable Object messages
├─ apps/
│  ├─ web/        # Vite + React shell + three.js board (thin view over engine)
│  └─ worker/     # Cloudflare Worker + Durable Objects (matchmaking + game rooms)
├─ tools/
│  └─ cli/        # headless "play a game" runner — the AI-plays-itself harness
└─ pnpm-workspace.yaml
```

**Stack:** TypeScript everywhere · pnpm workspaces · Vitest (tests) · Zod
(command/wire validation) · Vite + React + three.js (web) · Cloudflare Workers +
Durable Objects + Hono + WebSockets (backend).

---

## 4. Engine design

**Board:** a **flat-top hex grid** (M6) with a rectangular footprint, behind a
`Board` interface so no rule ever does coordinate math itself. Cells are stored
as offset "odd-q" coordinates in the `Vec {x, y}` (x = column, y = row); all hex
math (distance, neighbours, cells-in-range, line of sight) is done in cube
coordinates, converted internally. Melee = adjacent hex (6 neighbours); ranged
uses a cube-lerp hex line for LoS. (Through M5 this was a square grid with
Chebyshev distance and Bresenham LoS; the swap only touched `board.ts` plus the
thin views, because everything spatial already routed through `Board`.)

**Core state:** board dims + terrain; units (id, owner, Quality, Combat,
position, status flags such as knocked-down / benched / activated-this-round);
whose initiative; round number; RNG state; phase.

**Commands (MVP):** `ChooseActivation(unitId, diceCount)`, `Move(unitId, path)`,
`Attack(attackerId, targetId)`, `EndActivation`, plus setup commands. Every
command is validated against `getLegalCommands`.

**Combat:** opposed roll (attacker Combat + die vs defender Combat + die); margin
decides push-back / knockdown / kill. Minimal morale in v1.

---

## 5. The activation ruleset (v1) — the twist

- **Round structure:** players alternate activating **one unit per activation**.
  Initiative **alternates each round** (whoever went second last round leads).
- **Activation:** pick an un-activated unit, commit **1–3 dice**, roll each vs
  Quality (die ≥ Q = success). Successes fuel actions (move/attack).
  *With 1 die you can never turn over* (turnover needs 2+ failures) — the safe,
  low-output option.
- **Turnover (2+ failures):** the activation ends immediately (untaken actions
  lost) **and the player is benched for the rest of the round** — no more
  activations until next round.
- **Solo continuation:** if the opponent is benched or out of units, you keep
  activating one unit at a time until you turn over or run out.
- **Round end:** when no player has a unit that is both un-activated and not
  benched. Flags reset; initiative flips.

This is isolated in one `resolveActivation` / turn-controller module so the rule
stays swappable, and is fully covered by headless CLI + AI-vs-AI tests.

---

## 6. AI opponent (heuristic)

`chooseCommand(state) → Command`, importing only the engine. Scores candidates
from `getLegalCommands` with tactical heuristics (threat range, focus-fire the
weakest reachable enemy, avoid over-committing dice when behind on tempo, use
terrain/LoS). Deterministic given state + seed. Because it speaks only
`Command`, the **same AI is the test bot** — two AIs can play thousands of games
headlessly to smoke-test the rules.

---

## 7. UI (three.js) — thin view

React shell (menus, warband builder, HUD) + a three.js `<canvas>` that renders
board/terrain/minis (simple primitives / low-poly to start) and translates
clicks into `Command`s. The view **subscribes to engine events**
(`UnitMoved`, `DiceRolled`, `Turnover`, `UnitKilled`) to animate. The UI holds
no rules — remove three.js and the game still runs in the CLI.

---

## 8. Backend (Cloudflare)

- **Worker + Hono:** HTTP for lobby/matchmaking/warband storage; upgrades to
  WebSocket for a game.
- **Durable Object per game room:** holds authoritative `GameState`, receives
  `Command`s over WS, runs the *same* `reduce`, broadcasts events. Server-
  authoritative — clients send intents, the DO validates via `getLegalCommands`.
  The heuristic AI runs inside the DO for PvE.
- **Modes:** hotseat (single client, local engine, no network); PvE (local or
  DO-hosted AI); PvP online (DO-authoritative). Same engine in all three.

---

## 9. Testing strategy (the payoff)

1. **Unit tests** on `reduce` per mechanic (dice, turnover, combat margins).
2. **Property/invariant tests:** AI-vs-AI games over many seeds; assert no
   negative HP, only-legal commands applied, games terminate, activation/round
   counts correct.
3. **Golden replays:** seed + command list must always produce the same final
   state — catches accidental rule changes.
4. **CLI harness** (`tools/cli`): `pnpm play --seed 42 --p1 ai --p2 ai` prints a
   full turn-by-turn log. This is how features are validated before any 3D exists.

---

## 10. Roadmap

1. **M0 — Scaffold:** ✅ monorepo, engine skeleton, seeded RNG, `reduce` /
   `getLegalCommands` stubs, Vitest, CLI harness printing a board.
2. **M1 — Core loop (headless):** ✅ grid, movement, activation + dice + the
   alternating turnover twist, opposed combat, kill/knockdown. AI-vs-AI runs
   end-to-end in the CLI. *Playable without any UI.*
3. **M2 — Content:** ✅ point-buy builder + a few original preset warbands, with
   validation. (`packages/content`; CLI `--p0/--p1/--list`.)
4. **M3 — 3D UI:** ✅ Vite + React shell with a three.js `<canvas>` board for
   local hotseat and vs-AI. A thin view over the engine (`apps/web`): it
   subscribes to engine events to animate and translates clicks into `Command`s
   validated against `getLegalCommands`; army setup reuses `packages/content`
   and the AI opponent reuses `chooseCommand`. No game rules live in the UI.
5. **M4 — Online:** ✅ Worker + Durable Objects, WebSocket sync, matchmaking.
   A zod wire protocol (`packages/protocol`) is the trust boundary; a
   transport-agnostic `RoomEngine` and pure `Matchmaker` (`apps/worker`) hold
   all authority and are covered headlessly, with thin Durable Object + Worker
   adapters and a `wrangler.toml` over them. The web app plays local *or* online
   through one `MatchClient` seam. `wrangler deploy` ships it to Cloudflare.
6. **M5 — Polish:** ✅ more special abilities, morale depth, a replay viewer, and
   animations for the new events. Kept inside the pure seam:
   - **Special abilities** — three original traits behind the command/legal-move
     seams: **Ranged** (a `Shoot` command — non-adjacent, needs line of sight,
     no reprisal, blocked while in melee), **Tough** (first would-be kill becomes
     a knockdown), and **Guard** (a `Guard` action; a guarding unit ripostes the
     first melee attacker and can prevent the blow). Priced in `packages/content`
     and understood by the AI (`chooseCommand`).
   - **Morale depth** — beyond the turnover: a combat kill forces **fear** nerve
     checks on nearby friends (fail = knocked down), and a warband ground to a
     third of its starting size **breaks** once and **routs** (failed survivors
     flee). New events/state, deterministic and RNG-seeded.
   - **Replay viewer** — a `Replay` is `GameConfig + command list`; `runReplay`
     reproduces it, a golden fixture pins the final-state hash against accidental
     rule drift, and `apps/web` steps through a finished game (with JSON
     export/import) reusing the event-driven board.
   - **Animations** — the three.js view gained a ranged/riposte tracer, a guard
     ring, and toughness/rout flashes. UI only — no rules moved into the client.
7. **M6 — Hex board:** ✅ replaced the square grid with a **flat-top hex grid**
   (rectangular footprint, offset "odd-q" coordinates in the same `Vec {x, y}`,
   cube math internally). First the abstraction leaks were closed so every
   spatial question — distance, adjacency, cells-in-range, line of sight,
   in-bounds — routes through the `Board` interface (a new `cellsWithin`, and
   `inMelee`/morale radius now ask the board); then `makeSquareGrid` was swapped
   for `makeHexGrid`. Melee is an adjacent hex (6 neighbours), ranged fire uses a
   cube-lerp hex line, and the fear radius is hex distance. The `Replay` version
   was bumped to **2** (state coordinates and rule outcomes changed, so v1
   replays no longer load) and the golden fixture regenerated. Because a hex disc
   of radius *r* covers `3r(r+1)` cells (less than a square king-move window),
   `perMove` was repriced (3 → 2) and the four presets' stat lines were re-tuned
   until AI-vs-AI over every pairing × 20 seeds sat in a 43–54% band with no
   degenerate warband. The CLI ASCII board and the three.js view (hex-prism
   tiles, flat-top `cellToWorld`, pixel-to-hex picking, camera framing) were
   updated — UI only, no rules in the client.
8. **M7 — Terrain, maps & game modes:** ✅ the battlefield stopped being flat
   and "kill everything" stopped being the only way to win. Every addition is
   **optional, sparse state** omitted when default, so the flat annihilation game
   serialises byte-for-byte as before and the golden replay is untouched.
   - **Terrain** — `BoardData.terrain` holds per-hex `elevation` (0–3) and one
     `feature` (`rock` / `building`: impassable, block sight; `forest`: passable,
     blocks sight *through* it but not into/out of it). Moves must be reachable
     by a BFS path over passable hexes; line of sight is drawn from a canonical
     endpoint so it is symmetric. **High ground:** a standing combatant on a
     strictly higher hex gets +1 in melee, guard ripostes and shooting (attacker
     and defender alike), reported by optional bonus fields on combat events.
   - **Maps** (`packages/content`) — a JSON `MapDef` (size, hexes, deploy zones,
     objectives) with a strict zod schema, `validateMap` (size limits, passable
     deploy zones with room for a warband, objectives per mode) and
     `supportedModes`. `mapToBoard` + zone deployment feed `buildMatch`; the
     default `open-field` map reproduces the legacy layout exactly. Seven
     built-in maps live in `packages/content/maps/*.json` (Open Field, Rolling
     Hills, Old Forest, Ruined Village, Rocky Pass, Twin Towers, Crossroads).
   - **Game modes** (`GameConfig.mode`, engine `mode.ts`) — annihilation
     (default), **kill-the-king** (a designated King falling loses at once),
     **king-of-the-hill** (hold the hill at each round boundary, first to 5),
     **conquest** (three zones scored separately, first to 8) — both capped at
     round 12 with an annihilation-style tiebreak — and **capture-the-flag**
     (pick up / drop / return / capture, a capture wins). New events:
     `ScoreChanged`, `FlagPickedUp/Dropped/Returned/Captured`, `GameOver.reason`.
   - **AI** — `chooseCommand` pursues each objective (take and hold zones, fetch
     and carry flags, hunt carriers, guard its own King, focus the enemy's) and
     values high ground and cover. A self-play matrix plays every built-in map ×
     every mode it supports to completion with per-step objective invariants.
   - **Clients** — the three.js board extrudes hexes by elevation and draws
     low-poly rocks, connected buildings and cone trees, plus zone overlays,
     flags and crown/carrier badges; the HUD shows mode, scores and flag state
     and the log highlights objective events. A **terrain editor** (from Setup)
     paints elevation/features/zones with undo/redo and inline validation, and
     saves to localStorage or `.json`; custom maps appear in the Setup map
     picker (local play). Setup picks map → supported mode → King. The wire
     protocol and worker carry `mapId`/`gameMode`/`kings` (built-in maps only
     online), and the CLI gained `--map` / `--mode`.

---

## Suggested first build target

M0 + M1: a terminal command that plays a full **AI-vs-AI game with a turn-by-turn
log**, plus Vitest coverage of the turnover/round mechanics — proving the
architecture before any effort goes into 3D.
