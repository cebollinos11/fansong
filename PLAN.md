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
| Space model | **Square grid** (behind a `Board` interface so hex could be swapped later) |
| MVP scope | **Core loop first** — activation, the alternating turnover twist, movement, opposed combat, kill/knockdown, minimal morale |
| AI opponent | **Heuristic only** (pure, deterministic; doubles as the test bot) |
| Content | **Point-buy builder + a few original preset warbands** |
| Initiative | **Alternate each round** — whoever went second last round leads next |

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
│  ├─ content/    # warband builder, point costs, preset warbands (data + validation)
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

**Board:** square grid, config-driven cell size behind a `Board` interface so a
hex board could replace it. 8-directional movement, Chebyshev/graph distance,
grid line-of-sight (Bresenham supercover). Facing optional for MVP.

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

1. **M0 — Scaffold:** monorepo, engine skeleton, seeded RNG, `reduce` /
   `getLegalCommands` stubs, Vitest, CLI harness printing a board.
2. **M1 — Core loop (headless):** grid, movement, activation + dice + the
   alternating turnover twist, opposed combat, kill/knockdown. AI-vs-AI runs
   end-to-end in the CLI. *Playable without any UI.*
3. **M2 — Content:** point-buy builder + a few original preset warbands, with
   validation.
4. **M3 — 3D UI:** three.js board + React HUD for local hotseat and vs-AI.
5. **M4 — Online:** Worker + Durable Objects, WebSocket sync, matchmaking,
   deploy to Cloudflare.
6. **M5 — Polish:** more special abilities, morale depth, animations, replay viewer.

---

## Suggested first build target

M0 + M1: a terminal command that plays a full **AI-vs-AI game with a turn-by-turn
log**, plus Vitest coverage of the turnover/round mechanics — proving the
architecture before any effort goes into 3D.
