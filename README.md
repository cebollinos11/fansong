# FanSong

A fan, rules-compatible skirmish wargame with a "you go, I go" activation twist.
See [PLAN.md](PLAN.md) for the full design.

**Status: M0–M2 complete.** A full AI-vs-AI game is playable in the terminal —
now with original **preset warbands** and a **point-buy** cost model — plus
Vitest coverage of the rules, the costing, and full preset matchups. No UI yet:
the engine is a pure, deterministic state machine.

## Layout

```
packages/
  engine/   pure TS state machine: RNG, board, reduce, getLegalCommands, combat
  ai/       deterministic heuristic opponent (also the test bot)
  content/  point-buy costing, warband validation, original preset warbands
tools/
  cli/      `pnpm play` — headless AI-vs-AI runner with a turn-by-turn log
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
