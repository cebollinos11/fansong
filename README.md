# FanSong

A fan, rules-compatible skirmish wargame with a "you go, I go" activation twist.
See [PLAN.md](PLAN.md) for the full design.

**Status: M0–M3 complete.** A full AI-vs-AI game is playable in the terminal —
with original **preset warbands** and a **point-buy** cost model — and there is
now a **3D web UI** (`apps/web`: Vite + React + three.js) for local hotseat and
vs-AI play. Vitest covers the rules, the costing, full preset matchups, and the
UI's engine bridge. The engine remains a pure, deterministic state machine; the
UI is a thin view over it.

## Layout

```
packages/
  engine/   pure TS state machine: RNG, board, reduce, getLegalCommands, combat
  ai/       deterministic heuristic opponent (also the test bot)
  content/  point-buy costing, warband validation, original preset warbands
tools/
  cli/      `pnpm play` — headless AI-vs-AI runner with a turn-by-turn log
apps/
  web/      Vite + React + three.js UI — a thin view over the engine
```

## Quick start

```bash
pnpm install
pnpm test                 # 59 tests: rng, board, combat, turnover, rounds,
                          #           costing, validation, deploy, self-play
pnpm play                 # watch two demo AIs fight (seed 42)
pnpm play --list          # list the preset warbands
pnpm play --p0 iron-wardens --p1 ashfang-raiders   # a preset matchup
pnpm play --seed 7 -q     # a specific seed, result only
pnpm typecheck            # tsc across all packages
```

## Architecture in one line

`reduce(state, command) -> { state, events }` is the whole game — a pure
function with a seeded RNG stored *in* the state, so a game is fully determined
by `seed + command list`. `getLegalCommands(state)` enumerates every legal
action; the AI, the tests, and any future UI all pick from that list.

## The activation twist (implemented)

- Players alternate **one unit per activation**; initiative flips each round.
- An activation commits **1–3 dice** rolled vs the unit's Quality; successes
  become action points (move/attack).
- **2+ failures = turnover:** the activation ends and that player is **benched
  for the rest of the round**. With a single die you can never turn over.
- The other player then continues **solo** until they turn over or run out.
- Combat is an opposed roll; margins yield knockdown or kill.

All of this lives behind `reduce` / the turn controller and is covered by
`packages/engine/test` (mechanics) and `packages/ai/test` (AI-vs-AI invariants:
games terminate, only legal commands apply, no unit leaves the board, and a
seed replays identically).

## Content & point-buy (M2)

`packages/content` turns stat lines into armies:

- **Cost model** (`unitCost`) — an original, additive formula over the three
  stats the engine actually simulates (Quality, Combat, Move), so a point total
  is an honest measure of value with no unimplemented "paper" traits.
- **Validation** (`validateWarband`) — checks stat ranges, roster size, and a
  point budget (default 200), reporting every problem at once for a builder UI.
- **Presets** — three original warbands (`iron-wardens`, `ashfang-raiders`,
  `free-company`), each proven legal by the test suite.
- **Deploy** (`buildMatch`) — lays two warbands out facing off and emits an
  engine `GameConfig`; the CLI and any future UI share it.

`packages/content/test` covers the costing and validation; the
`tools/cli/test` preset-match suite plays every preset pairing to a decisive,
reproducible finish.

## 3D UI (M3)

`apps/web` is a Vite + React shell with a three.js `<canvas>` board for local
**hotseat** and **vs-AI** play. It is a strictly thin view over the engine:

- **No game rules.** All legality comes from `getLegalCommands`; the board only
  projects that list into highlights (green move tiles, attackable enemies,
  selectable units) and turns clicks back into `Command`s.
- **Event-driven animation.** It subscribes to engine transitions and animates
  from `GameState` (units lerp between cells, knockdowns tilt, kills fade) plus
  transient combat flashes from events like `AttackResolved`/`UnitKilled`.
- **Reuse, not reimplementation.** Army setup uses `buildMatch` + `PRESETS` +
  `validateWarband` from `packages/content`, and the vs-AI opponent is the same
  `chooseCommand` heuristic used by the CLI and the test bot.

The engine is driven through a single `MatchController` (`src/game/`), which
validates every command against `getLegalCommands` before `reduce` — the exact
seam a future Cloudflare Durable Object (M4) will slot into. Its behaviour is
covered headlessly by `apps/web/test` (no DOM), including a full AI-vs-AI game
played entirely through the controller.

```bash
pnpm --filter @fansong/web dev      # dev server at http://localhost:5173
pnpm --filter @fansong/web build    # production build
```
