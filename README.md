# FanSong

A fan, rules-compatible skirmish wargame with a "you go, I go" activation twist.
See [PLAN.md](PLAN.md) for the full design.

**Status: M0–M7 complete; M8 (source-game melee & shooting rules) in progress.** The game plays on a **flat-top hex grid** (M6) with
**terrain, premade maps, a map editor and five game modes** (M7). A
full AI-vs-AI game is playable in the terminal —
with original **preset warbands**, a **point-buy** cost model, **special-ability
traits** (ranged, tough, guard) and **morale** (fear + rout) — there is a
**3D web UI** (`apps/web`: Vite + React + three.js) for local hotseat and vs-AI
play with a **replay viewer**, and there is **online multiplayer**: a Cloudflare
Worker + Durable Objects backend (`apps/worker`) with join-by-code rooms and
WebSocket sync, spoken through a zod wire protocol (`packages/protocol`). Vitest covers the
rules (including the new traits, morale, and replay determinism), the costing,
full preset matchups, the UI's engine bridge and replay recording, the wire
schemas, and the server room (including full games played through the network
seam). The engine remains a pure, deterministic state machine; every client is a
thin view over it.

## Layout

```
packages/
  engine/   pure TS state machine: RNG, hex board, reduce, getLegalCommands, combat
  ai/       deterministic heuristic opponent (also the test bot)
  content/  point-buy costing, warband validation, original preset warbands,
            map format + validation, built-in maps (maps/*.json), editor model
  protocol/ zod wire schemas + client/server message envelopes (the trust boundary)
tools/
  cli/      `pnpm play` — headless AI-vs-AI runner with a turn-by-turn log
apps/
  web/      Vite + React + three.js UI — plays local or online via one seam
  worker/   Cloudflare Worker + Durable Objects — authoritative rooms joined by code
```

## Quick start

```bash
pnpm install
pnpm test                 # 600+ tests: rng, hex board, terrain/LOS, combat, turnover,
                          #            rounds, abilities, morale, game modes,
                          #            replay/golden, costing, validation, maps,
                          #            deploy, self-play (map × mode), editor,
                          #            wire schemas, server rooms + lobby
pnpm play                 # watch two demo AIs fight (seed 42)
pnpm play --list          # list preset warbands, built-in maps and modes
pnpm play --p0 iron-wardens --p1 ashfang-raiders   # a preset matchup
pnpm play --map twin-towers --mode capture-the-flag  # a map + game mode
pnpm play --seed 7 -q     # a specific seed, result only
pnpm play --help          # every option
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
- **2+ failures = turnover:** that player is **benched for the rest of the
  round** — though the unit still spends any action its successes earned first.
  With a single die you can never turn over.
- The other player then continues **solo** until they turn over or run out.
- Combat is an opposed roll. Doubling the loser kills; a plain win pushes the
  loser back a hex on the winner's odd die or knocks it down on an even one
  (a loser with nowhere to go falls instead). A knocked-down
  defender only hurts its attacker on a natural 6 that also wins the roll;
  otherwise its best result is a clash. Tripling the loser is a **gruesome
  kill** — the only kind of death that makes nearby friends test their nerve.
- **Contact:** a unit that walks next to an enemy stops there, and a unit
  leaving contact takes a **free hack** from each standing enemy it was
  touching (it can't hit back; a knockdown stops it in its tracks).
- **Outnumbering:** in melee, each standing enemy in contact beyond the first
  costs −1.
- **Shooting:** −1 beyond short range (the first half of the shooter's reach)
  and −1 against a target in cover (in a forest, or only just visible past a
  blocker).

All of this lives behind `reduce` / the turn controller and is covered by
`packages/engine/test` (mechanics) and `packages/ai/test` (AI-vs-AI invariants:
games terminate, only legal commands apply, no unit leaves the board, and a
seed replays identically).

## Content & point-buy (M2)

`packages/content` turns stat lines into armies:

- **Cost model** (`unitCost`) — an original, additive formula over what the
  engine actually simulates (Quality, Combat, Move and the traits), so a point
  total is an honest measure of value with no unimplemented "paper" traits.
  Every unit moves 5 hexes per Move action; the Slow and Fast traits make it
  3 or 7.
- **Validation** (`validateWarband`) — checks stat ranges, roster size, and a
  point budget (default 200), reporting every problem at once for a builder UI.
- **Presets** — five original warbands (`iron-wardens`, `ashfang-raiders`,
  `free-company`, `hollow-watch`, `thorn-patrol`), each proven legal by the test suite. The cost
  model prices the M5 traits too (ranged reach, plus flat Tough/Guard surcharges).
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

## Online multiplayer (M4)

Online play is **server-authoritative**, and the server reuses the exact same
engine as everything else:

- **`packages/protocol`** — a **zod** wire protocol. `commandSchema` is the trust
  boundary: the server never `reduce`s a client frame it hasn't validated first.
  Compile-time drift guards assert the schemas stay identical to the engine's own
  types, so the wire and the engine can't silently diverge.
- **`apps/worker`** — the backend, built headless-first:
  - **`RoomEngine`** — a transport-agnostic authoritative room. Between games it
    is a lobby (the host picks map and mode, each player their own army and
    King, and the game starts when both are ready); during a game it is the
    server-side twin of the web client's `MatchController`: every command goes
    through the same `applyCommand` guard (validate against `getLegalCommands`,
    then `reduce`). It speaks only a tiny `RoomConnection` interface, so its
    whole behaviour — seats, lobby, authority, legality, presence, rejoining,
    rematches — is tested with fake sockets and **zero Cloudflare runtime**.
  - **Durable Object + Worker** (`GameRoomDO`, `index.ts`) are thin adapters:
    `POST /api/rooms` opens a room under a fresh 5-letter code, and
    `/api/room/:code` is its WebSocket. Idle rooms are wiped after a day.

```bash
pnpm --filter @fansong/worker dev       # local worker at http://localhost:8787
pnpm --filter @fansong/worker deploy    # deploy to Cloudflare (needs `wrangler login`)
```

Point the web app at a deployed worker with `VITE_SERVER_URL` (it defaults to the
local `wrangler dev` address). In the setup screen, pick **Online with a friend**
and **Create a room**, then send your friend the code (or the `?room=CODE` invite
link); they enter it under **Join room**. In the room's lobby each player picks
their own army (preset or army-builder), the host picks a built-in map and game
mode, and the game starts once both press **Ready**. A player who drops can
rejoin with the same code, and after a game **Rematch** returns both to the
lobby. The `apps/web` client plays
local *or* online through one `MatchClient` interface — the board, HUD, and
interaction code never know which they're driving.

## Polish: abilities, morale, replays (M5)

Everything M5 adds lives inside the same `reduce(state, command)` seam, so it is
seed-reproducible and unit-tested headlessly; the clients only learn to draw it.

- **Special abilities** — three original traits, each behind the command /
  legal-move seams and priced in `packages/content`:
  - **Ranged** (`Shoot`) — fire on a non-adjacent enemy within range and line of
    sight, with no return damage; you can't shoot while locked in melee.
  - **Tough** — the first would-be kill is downgraded to a knockdown.
  - **Guard** (reaction) — a `Guard` action assumes a stance; a guarding unit
    strikes the first melee attacker *first*, and a good riposte prevents the
    attack outright (resolved synchronously — no turn interrupts).

  The AI (`chooseCommand`) uses them: shooters seek a standoff and fire, and the
  `hollow-watch` preset fields all three.

- **Morale depth** — beyond the activation turnover:
  - **Fear** — when a unit suffers a gruesome kill in combat, standing friends
    within four hexes take a nerve check (d6 ≥ Quality) or flee.
  - **Rout** — the first time a warband is ground to a third of its starting
    strength it *breaks*: every survivor tests nerve, and each that fails flees.
    It happens once per side.
  - **Fleeing** — a unit that fails runs back to its own edge of the map,
    taking free hacks from any foe it turns its back on; one already on its
    edge leaves the field. A failed check never knocks a unit down.

- **Replays** — a `Replay` is just `GameConfig + command list`. `runReplay`
  reproduces the whole game from it; `hashGameState` + a committed golden fixture
  (`pnpm --filter @fansong/cli gen:golden` to re-bless) catch accidental rule
  drift. In `apps/web`, a finished local game can be **watched back** (play /
  step / scrub) and **exported/imported as JSON**, reusing the event-driven board
  — with new FX for shots, ripostes, toughness saves, guard stances, and routs.

## Hex board (M6)

The battlefield is a **flat-top hex grid** with a rectangular footprint (the
square grid through M5 was always kept behind a `Board` interface for exactly
this swap):

- **One seam for all geometry.** Distance, adjacency, cells-in-range, line of
  sight, and in-bounds are the `Board`'s job — no rule does coordinate math
  itself. Cells are stored as offset "odd-q" coordinates in the same
  `Vec {x, y}` (x = column, y = row), so the wire schema and `"x,y"` keys are
  unchanged; all hex math runs in cube coordinates, converted internally.
- **Rules on hexes.** Melee is an adjacent hex (6 neighbours), ranged fire needs
  a clear cube-lerp hex line (intervening units/terrain block, endpoints don't),
  the Move action still reaches any unblocked, unoccupied cell within `move`
  hexes, and the fear radius is hex distance.
- **Balance.** A hex disc of radius *r* holds `3r(r+1)` cells — less reach than a
  square king-move window — so `perMove` was repriced (3 → 2) and the four
  presets re-tuned. AI-vs-AI over every pairing × 20 seeds now sits in a 43–54%
  win band with no degenerate warband, and every game still terminates decisively.
- **Replays.** The `Replay` version is bumped to **2** (coordinates and outcomes
  changed), so pre-M6 replays no longer load; the golden fixture was regenerated.
- **Views.** The CLI prints a staggered hex ASCII board and the three.js view
  draws hex-prism tiles with correct pixel-to-hex click picking — UI only.

The engine is still the whole game: remove three.js, React, and the worker and a
seed + command list replays byte-for-byte in the terminal.

## Terrain, maps & game modes (M7)

The default game is still the flat 12×10 annihilation board, byte-for-byte (the
golden replay is unchanged): everything below is optional state that is simply
absent when unused.

- **Terrain** — each hex has an **elevation** 0–3 and at most one **feature**:
  - `rock`, `building` — impassable, block line of sight;
  - `forest` — passable; blocks sight *through* it, but a unit inside a forest
    hex can see out and be seen.

  Moves need a real path around obstacles (at most `move` steps). **High
  ground:** a standing combatant on a strictly higher hex gets **+1** to its
  roll — attacking, defending, riposting or shooting — and the log says so.
- **Maps** — a JSON `MapDef` (`id`, `name`, `width`, `height`, row-major
  `hexes: {elevation, feature}[]`, per-player `deployZones`, `objectives`),
  checked by a zod schema and `validateMap` (size limits, passable deploy zones
  with room for a warband, objectives valid for the mode); `supportedModes(map)`
  says which modes a map can host. Built-ins live in `packages/content/maps/`:

  | Map | Character | Modes beyond annihilation / kill-the-king |
  |-----|-----------|-------------------------------------------|
  | Open Field | the flat default board | — |
  | Rolling Hills | elevation-heavy, few features | king-of-the-hill |
  | Old Forest | dense forest, line-of-sight play | capture-the-flag |
  | Ruined Village | buildings and streets | king-of-the-hill, capture-the-flag |
  | Rocky Pass | rocks, chokepoints, a ridge | king-of-the-hill |
  | Twin Towers | two raised plateaus | capture-the-flag |
  | Crossroads | three objective zones | king-of-the-hill, conquest |

- **Game modes** (chosen in Setup or with `--mode`; the map must support it):
  - **annihilation** — the default: destroy or rout the enemy warband.
  - **kill-the-king** — each side has one **King** (♛; picked in Setup, the most
    expensive unit by default). Your King falls → you lose at once.
  - **king-of-the-hill** — at each round boundary, whoever has more standing
    units on the hill scores 1. First to **5**, else the higher score after
    round 12 (ties go to an annihilation-style tiebreak).
  - **conquest** — as above with three zones (A/B/C) scored separately; first
    to **8**, else higher score after round 12.
  - **capture-the-flag** — move onto the enemy flag to pick it up; a knocked-down
    or killed carrier drops it; move onto your own dropped flag to return it;
    end a move on your base with the enemy flag to win.

  The heuristic AI plays every mode (zones, flags, Kings, high ground and cover),
  and a self-play matrix runs every built-in map × every mode it supports.
- **Map editor** — the web app's Setup screen has a **Map editor…** button: pick
  a size, then paint elevation (raise / lower / set / erase), buildings (click or
  drag a footprint), forest and rocks (brush radius 0–2, drag-fill), deploy
  zones, flag bases, the hill and conquest zones. Undo/redo, inline validation,
  save to the browser (localStorage) or export/import `.json`. Valid custom maps
  show up in the Setup map picker for local games; online matches use built-in
  maps only (the server can't see your browser's maps).
- **Army builder** — the Setup screen's **Army builder…** button makes custom
  warbands with **no point limit** (1–30 units; the total is shown so players can
  agree on a size). Start blank or from a preset, add preset units as templates,
  set each unit's stats, traits and which sprite it *looks like*. Save to the
  browser (localStorage) or export/import `.json`. Saved armies show up in the
  warband pickers for vs-AI, hotseat and online play; they travel inside the
  `MatchSetup` as `warbands`, so the server and replays need no local storage.
- **In the web UI** hexes are extruded by elevation with low-poly rocks, joined
  buildings and cone trees; zones, flags, crowns and flag carriers are marked on
  the board, and the HUD shows the mode, scores and flag status.
