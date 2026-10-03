# Extract the golden Pig — new game mode


## Context

FanSong has five modes, all symmetric. This adds an asymmetric escort mode: one
side must walk a slow, valuable unit (the golden Pig) across the map into the
enemy's deploy zone; the other side must kill it or run out the clock. It reuses
the existing deploy zones as the goal, so every map (built-in, editor, random)
hosts it with no new map data.

## Rules (agreed)

- **Mode id** `golden-pig`, label **"Extract the golden Pig"**.
- **Sides:** one seat escorts, chosen in Setup / by the online host; default player 0.
- **The Pig:** a fixed unit added free to the escorting warband.
  Quality 3, Combat 3, Slow, Tough, no other traits. Drawn as the existing
  `Piglet` sprite (`look: 'Piglet'`) with a gold tint (`tint: '#ffd700'`).
- **Escort wins** when the Pig ends an activation on any hex of the enemy deploy
  zone. Any activation end counts (out of actions, voluntary end, or a turnover
  while already there). Being pushed in does not win by itself.
- **Defender wins** when the Pig is killed or routed, or when the round limit is reached
  (no tiebreak).
- Wiping out the defenders still wins for the escort (existing annihilation check).
- The goal is the plain enemy deploy zone. Walling it with a big warband is
  accepted for v1 and watched for in self-play.

Assumptions to confirm while implementing (not yet explicitly agreed):
- The Pig must be on its feet to win (a knocked-down Pig ending an activation in the zone does not count).
- Default round limit = `ceil(walkDistance / 3) + 2`, clamped to `LIMIT_RANGE`,
  where `walkDistance` is the shortest walk from the escort's zone to the goal
  (≈6 rounds on the default 12×10 board, ≈15 on 40-wide maps). It is a starting
  value to be tuned by the AI bench. The custom round limit overrides it.

## Implementation

### 1. Engine (`packages/engine/src`)
- `mode.ts`
  - Add `'golden-pig'` to `GameMode`, `GAME_MODES` and `MODE_RULES` (`requires: 'extraction'`).
  - `ModeObjectives.extraction?: Vec[]` (the goal hexes; copied by `createModeState` like `hill`).
  - `ModeState.pig?: { unitId: string; escort: Owner }`.
  - Helpers next to `kingOf` / `fallenKingOwner`: `pigOf(state)`, `isPig(state, id)`,
    `pigExtracted(state, unitId)` (unit is the Pig, alive, standing, on a goal hex).
  - `roundLimitWinner`: in this mode return the defender (`other(pig.escort)`).
- `types.ts`: `UnitSpec.pig?: boolean` (like `king`); add `'pig'` (Pig fell) and
  `'extracted'` to `GameOverReason`.
- `setup.ts` (`createGame`, beside the `kingId` line): find the single spec flagged
  `pig` across both warbands, throw unless exactly one, set `mode.pig`.
- `reduce.ts`
  - `endActivation`: right after the `ActivationEnded` event, if
    `pigExtracted(s, endedId)` → `finishGame(s, events, escort, 'extracted')` and return.
    Verify the turnover path (around line 184–219) reaches `endActivation`; if it
    doesn't, add the same check there.
  - `checkGameOver`: after the King check, a dead Pig → `finishGame(defender, 'pig')`.
- Additive optional state only: the golden replay hash must not change and the
  `Replay` version is not bumped.

### 2. Content (`packages/content/src`)
- New exported `GOLDEN_PIG: WarbandUnit` (profile above; name "Golden Pig").
- `deploy.ts`
  - `MatchOptions.escort?: Owner` (default 0).
  - `buildMatch`: in this mode lay the escort's warband out as `[GOLDEN_PIG, ...units]`
    (so the Pig lands in the centred back rank — `layOutInZone` fills the rank
    farthest from the enemy first), then move the Pig's spec to the **end** of the
    array so existing unit ids (`p{owner}u{i}`) are unchanged; flag it `pig: true`.
  - `objectives.extraction` = the defender's `map.deployZones` hexes. No-map
    branch: the defender's edge column of the flat board.
  - When `opts.limits?.roundLimit` is undefined, set it from an exported
    `defaultPigRounds(map, escort)` (formula above; walking distance via the engine
    `Board` built with `mapToBoard`).
- `mapValidate.ts` `missingObjective`: `'golden-pig'` → `undefined` (every valid map hosts it).
- `match.ts`: `MatchSetup.escort?: Owner`, passed through `configFromSetup`.

### 3. Protocol + worker
- `packages/protocol/src/schema.ts`: add the mode to the `modeStateSchema` enum,
  `pig` to mode state, `extraction` to `modeObjectivesSchema`, `pig` to the unit
  spec schema, `escort` to the match-setup schema, and the two new reasons to the
  `GameOver` reason enum.
- `packages/protocol/src/messages.ts`: the host's lobby settings carry `escort`.
- `apps/worker/src/room.ts`: store the host's `escort` with map/mode and put it
  on the setup (beside the `kings` line ~110).

### 4. Web (`apps/web/src`)
- `ui/editorView.ts`: `MODE_LABELS['golden-pig']`.
- `ui/modeView.ts`: HUD goal ("Get the golden Pig into the enemy camp" + `limitText`)
  and a status line for the Pig; `modeOverlays` tints the goal zone; `unitBadges`
  marks the living Pig (reuse `'crown'` or add a badge in `three/BoardView.ts`
  `drawMarkings`); fold the Pig into `modeMarkingsKey`.
- `ui/SetupScreen.tsx` + `game/setupPrefs.ts`: an "Escort: P0 / P1" picker shown
  in this mode, saved in prefs, passed in `launchFor`; the Game length box shows
  `defaultPigRounds` as the default.
- `ui/LobbyScreen.tsx`: host picks the escorting seat; both players see it.
- Game-over text for the `'pig'` and `'extracted'` reasons (grep where `'king'` /
  `'flag'` reasons are worded, including the event log).

### 5. CLI (`tools/cli/src`)
- `options.ts`: accept the mode without objectives (line ~158) and add `--escort 0|1`.
- `format.ts`: mark the Pig in the roster summary like the King's ♛.

### 6. AI (`packages/ai/src/index.ts`)
Reuse the King machinery rather than writing a new planner:
- Generalise `kingPlan` so in this mode the escort side gets `ourKing = Pig`,
  `theirKing = undefined`, and the defender gets `theirKing = Pig`, `ourKing = undefined`.
  That gives the escort its threat-clearing behaviour and the defender its hunt
  (`kingTargetBonus`, `kingHuntDistance`) for free; value the Pig at `KING_WORTH`.
- Override the Pig's own scoring: moves are scored by walking distance to the goal
  using the existing distance-field helper (the "walking distance … to the nearest
  of `targets`" function near line 821, already used by the flag carrier); it
  activates early when the goal is reachable this activation, and prefers 3 dice
  only then or when no enemy threatens it.
- Escorts with no threat to answer advance ahead of the Pig along its route;
  defenders with no reach on the Pig move to stand between it and the goal.
- Measure per CLAUDE.md "Changing the AI": bench escort win rate across maps ×
  presets × seeds, each seat escorting on the same seed. Target 40–60% escort
  wins; tune `defaultPigRounds` first, then Pig Quality. Check for goal-walling
  and decision time on `stone-crown`.

### 7. Docs
- `README.md`: add the mode to the Game modes list and Game length paragraph, and
  reword the map table header ("Modes beyond annihilation / kill-the-king").
- `PLAN.md`: note the mode under M8 or as a new milestone.

## Tests
- `packages/engine/test/pig.test.ts` (model on `king.test.ts`): win on activation
  end in zone (out of actions, voluntary end, turnover); no win when pushed in or
  knocked down; Pig killed / routed → defender; round limit → defender; defenders
  annihilated → escort; `createGame` throws without exactly one Pig.
- `packages/content/test/deploy.test.ts`: Pig appended last, placed in the back
  rank, other unit ids unchanged; goal = defender zone; default round limit;
  `escort: 1`; `supportedModes` includes the mode for every built-in map.
- `packages/ai/test/selfplay.test.ts`: the map × mode matrix covers it (confirm it
  iterates `supportedModes`); add a Pig case to `kings.test.ts`-style AI tests.
- `apps/web/test/modeView.test.ts`: HUD, overlay, badge, markings key.
- Protocol schema round-trip for the new state and messages.

## Verification
```bash
pnpm typecheck
pnpm test
pnpm play --mode golden-pig --map ember-rift --escort 1
```
- The golden replay test passes without re-blessing.
- Web: `pnpm --filter @fansong/web dev`, start the mode from Setup on a small and
  a large map; confirm the gold Piglet deploys in the back rank, the goal zone is
  tinted, the HUD shows the round limit, and both end states read correctly.
  Use `?dev=1&sandbox` to stage the Pig one move from the zone.
- Online: `pnpm --filter @fansong/worker dev`, host picks the mode and escort seat.
