# FanSong

A fan, rules-compatible skirmish wargame with a "you go, I go" activation twist.
See [PLAN.md](PLAN.md) for the full design.

**Status: M0 (scaffold) + M1 (core loop, headless) complete.** A full AI-vs-AI
game is playable in the terminal, with Vitest coverage of the turnover/round
rules. No UI yet — the engine is a pure, deterministic state machine.

## Layout

```
packages/
  engine/   pure TS state machine: RNG, board, reduce, getLegalCommands, combat
  ai/       deterministic heuristic opponent (also the test bot)
tools/
  cli/      `pnpm play` — headless AI-vs-AI runner with a turn-by-turn log
```

## Quick start

```bash
pnpm install
pnpm test                 # 28 tests: rng, board, combat, turnover, rounds, self-play
pnpm play                 # watch two AIs fight (seed 42)
pnpm play --seed 7        # a specific seed
pnpm play --seed 7 -q     # result only
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
