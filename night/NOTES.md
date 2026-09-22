# Night build notes

- Backlog: 42 tasks. Key constraint: `hashGameState` is `JSON.stringify(state)`, so all new
  state (terrain, mode, scores, flags) must be optional and omitted when default to keep the
  golden replay byte-identical.
- There is no in-engine deploy phase (units are placed by `GameConfig`), so kill-the-king's
  "designate during deploy" will be a `UnitSpec.king` flag chosen in Setup (task 27/37).
- Task 1: `BoardData.terrain?: Record<"x,y", {elevation?, feature?}>` (sparse, keys sorted,
  defaults stripped by `normalizeTerrain`). `Board.isBlocked` now also covers rock/building, so
  move-destination checks and neighbours already respect them; added `Board.elevation/feature`.
  Skipped a separate `isPassable` (it would equal `!isBlocked`). Protocol `boardDataSchema` is
  `.strict()` and will reject terrain until task 5.
- Task 2: `lineOfSight` treats any feature (rock/building/forest) on an *intermediate* hex as
  blocking (new exported `blocksSight`); endpoints never block, so units in forest see/are seen.
  For symmetry the line is always drawn from the lexically lower (x, then y) endpoint, so
  edge-grazing ties round identically both ways. Golden replay unchanged by the canonicalisation.
- Task 3: `Board.reachableWithin(from, steps)` — BFS over `neighbors` (which already skip
  out-of-bounds/blocked/rock/building), returns a `Set` of "x,y" keys, start excluded. Legal
  moves still iterate `cellsWithin` order (filtered by reach + unoccupied) so command order,
  AI choices and the golden replay are unchanged; `handleMove` rejects unreachable
  destinations ("destination unreachable within move range"). Units never block paths.
  Web/AI/CLI derive move targets from legal commands, so no other callers needed changes.
- Task 4: `highGroundBonus(board, unit, opponent)` in combat.ts (+1 if standing and strictly
  higher). Applied to both sides of melee attacks, guard ripostes and shots (shot target gets it
  too — spec says "attacker and defender alike"). Events gain optional `attackBonus`/`defenseBonus`
  (Attack/Shot) and `guardBonus`/`attackerBonus` (riposte), spread in only when non-zero so flat
  games' events are unchanged. Also added these optional fields to the protocol event schema now
  (non-strict zod objects would otherwise silently strip them over the wire).
- Task 5: protocol `boardDataSchema` gains optional `terrain` (`z.record` keyed `^\d+,\d+$` →
  strict `hexTerrainSchema`: int elevation 0..MAX_ELEVATION, feature from `TERRAIN_FEATURES`).
  Protocol now imports those two runtime constants from the engine (it was type-only before).
  Elevation 0 is accepted on the wire (engine normalises it away). Added `BoardData`/`HexTerrain`
  drift guards. There is no `GameConfig` schema in protocol (setup travels as `MatchSetup`); map
  and mode fields for that come in task 32.
- Task 6: CLI `renderBoard` draws features as `^` rock / `B` building / `T` forest (legacy
  `blocked` stays `#`; a unit's initial wins over a feature, e.g. a unit in forest). Elevation
  1–3 is printed as a digit in the spacer column right after the glyph (neighbouring columns
  sit on alternate lines, so that column is always free). Flat boards render exactly as before.
  Added `tools/cli/test/format.test.ts`.
- Task 7: new pure `apps/web/src/three/terrain.ts` (`hexElevation`, `surfaceY`, `tileHeight`,
  top/side colours) + `apps/web/test/terrain.test.ts`. Every tile prism stands on a shared floor
  (y = -0.1) and rises 0.32 per level; side faces (cylinder material group 0) are a darker shade
  of the top, and raised tops tint toward an olive "high ground" colour. Flat tiles keep their
  exact old size/position/checkerboard (sides now slightly darker than tops). Units' groups are
  lifted by the hex's elevation (lerped, so moves climb/descend); highlights, missiles and tracers
  follow. Cell picking now raycasts the tile meshes (so tops *and* cliff faces resolve to the
  right hex), falling back to the ground plane. Legacy `blocked` pillars rise 0.4 above their hex.
  Verified visually with a throwaway elevated replay in the replay viewer (Playwright).
- Task 8: new pure `apps/web/src/three/features.ts` (`featureLayout(board, centre, hexSize)` →
  typed pieces: `rock` dodecahedron clusters, `box` building bodies/roofs, `cone`/`trunk` trees;
  deterministic per-cell jitter via `cellNoise`) + `apps/web/test/features.test.ts`. Adjacent
  building hexes get one wall+roof connector box per pair along the centre line, so blocks read
  as one structure; only joined at equal elevation (a cross-level connector would float or
  clip). Forest trees sit on the hex rim so a unit in the forest stays visible. BoardView builds
  meshes with shared unit geometries + flat-shaded materials cached by colour; feature meshes
  carry `userData.cell` and are raycast with the tiles, so clicking a tree/rock picks its hex.
  Verified visually (Playwright screenshot of a throwaway terrain replay).
- Task 9: new pure `apps/web/src/ui/hexInfo.ts` (`describeHex(state, cell)` → title + lines:
  elevation, legacy blocked, feature with its sight/movement rule, living unit on the hex) and
  `apps/web/test/hexInfo.test.ts`. BoardView gained `onCellHover` (pointermove/leave, emits only
  when the hex changes, hidden while a mouse button is held for orbit/pan); picking was factored
  into `aimRay`/`pickUnit`/`pickCell`, and hovering a figure reports the unit's own hex rather
  than the tile behind it. BoardCanvas shows the info as a fixed bottom-left HUD panel (not a
  cursor-following tooltip), so both game and replay screens get it. Battle log now prints
  high-ground bonuses as `(7, +1 high ground)`; riposte lines also show both scores now (they
  had none before). Verified in the built app with Playwright (tile + unit hover).
- Task 10: new `packages/content/src/map.ts` — `MapDef`/`MapHex`/`MapObjectives` types, strict zod
  schemas (`mapDefSchema`, `mapHexSchema`, `mapObjectivesSchema`), `parseMap` (throws with issue
  paths) and `mapHexAt`, plus schema↔type drift guards; content now depends on zod. Decisions:
  `hexes` is a dense row-major array (`hexes[y*width+x]`, elevation required, feature omitted for
  open ground) as the spec lists `{elevation, feature}[]`; `deployZones` is a `[p0, p1]` tuple of
  hex lists; `objectives` = optional `flags` ([p0 base, p1 base]), `hill` (hex list) and
  `conquest` (exactly 3 hex lists). Map `id` must be a lowercase-hyphen slug. The schema is purely
  structural — size limits, hex count and bounds checks are left to `validateMap` (task 11).
  Legacy `blocked` cells are not part of the map format (features cover it). No `GameMode` type
  yet; it arrives with the mode model (tasks 11/26).
- Task 11: new `packages/content/src/mapValidate.ts` — `validateMap(map, mode?, limits?)` →
  `{ ok, errors }` (reports every problem at once, like `validateWarband`), `supportedModes(map)`
  and `MAP_LIMITS`. Added a type-only `GameMode` + `GAME_MODES` in `packages/engine/src/mode.ts`
  now (no state impact) so content and later tasks share one mode type. Decisions: map size
  6–24 on each axis; each deploy zone needs >= 12 hexes (`DEFAULT_RULES.maxUnits`, room for a
  full warband), passable (forest/elevation OK), no duplicates, zones disjoint; every deploy hex
  must sit in one walkable region (BFS via the engine board) so no unit can be stranded. Every
  objective the map *provides* must be valid even when not playing that mode: flag bases
  passable + distinct (may sit in/out of deploy zones); hill/conquest zones non-empty, passable,
  not overlapping deploy zones, conquest zones mutually disjoint. Annihilation and kill-the-king
  need no objectives; an invalid map supports no modes.
- Task 12: `mapToBoard(map)` + `flatMap(w, h, id?, name?)` in `map.ts`; `DEFAULT_MAP`
  (= `flatMap(12, 10)`, id `open-field`, deploy zones = the two edge columns per side) and
  `layOutInZone(units, owner, map)` in `deploy.ts`. `MatchOptions.board` is now optional
  (defaults to `DEFAULT_BOARD`) and `MatchOptions.map` wins over it; `buildMatch` with a map runs
  `validateMap` and throws on an invalid map. Zone deployment rule: zone hexes are grouped into
  ranks by hex distance to the nearest enemy deploy hex, farthest rank fills first, overflow
  spills forward; each rank is ordered across the enemy direction (by row when the zones face
  left/right, by column when up/down) and models take a centred run — on `DEFAULT_MAP` this is
  byte-identical to the legacy `layOutWarband` (tested for every preset pair incl. 12-unit
  overflow). Callers (CLI, `configFromSetup`) still use the legacy board path; switching them to
  maps is task 17.
- Task 13: new `packages/content/src/mapRegistry.ts` — `listMaps()`, `getMap(id)`, `DEFAULT_MAP_ID`.
  Decisions: map JSON files are imported *explicitly* (no `import.meta.glob`/fs) so Vite, wrangler
  and tsx all inline them — verified via web build and `wrangler deploy --dry-run`; a test reads
  `maps/` with fs and fails if a file isn't registered or isn't named `<id>.json`. Each built-in
  map is `parseMap`+`validateMap`'d at module load and throws if invalid (duplicate ids too).
  Added `maps/open-field.json` (tested equal to `DEFAULT_MAP`) as the first/default entry so the
  loader is exercised before the premade maps land. Added `mapToJson(map)` in `map.ts`: a stable,
  diff-friendly format (one hex row per line, one zone per line); a test pins every map file to
  that canonical form, so author maps by generating them through `mapToJson`. Editor export can
  reuse it (task 25).
- Task 14: added `maps/rolling-hills.json` and `maps/old-forest.json` (both 14×12, edge-column
  deploy zones like `flatMap`), registered after `open-field`. Maps are authored in code by
  `packages/content/scripts/build-maps.ts` (`pnpm tsx packages/content/scripts/build-maps.ts`;
  typechecked via content's tsconfig) — tasks 15/16 should add their maps there. Decisions:
  premade maps use an even width and are laid out point-symmetrically ((x,y)→(W-1-x,H-1-y) is an
  exact isometry on the odd-q grid), and a test enforces symmetry of terrain, deploy zones, flags
  and hill for *every* built-in map. Rolling Hills: central level-3 plateau (10 hexes, the `hill`
  objective) plus flanking level-2/1 hills, 10 features. Old Forest: ~60 forest hexes from
  deterministic symmetric noise, a central glade + two side clearings, 4 rocks, lighter forest in
  column 2/11; provides `flags` at (0,5)/(13,6) so it supports CTF. New
  `test/mapSelfPlay.test.ts` plays 4 AI-vs-AI annihilation games per built-in map (varied presets)
  and checks no living unit stands on an impassable hex; content gained `@fansong/ai` as a
  devDependency for this (no cycle: ai depends only on engine).
- Task 15: added `maps/ruined-village.json` and `maps/rocky-pass.json` (14×12, point-symmetric,
  generated by `build-maps.ts`, registered after old-forest). Ruined Village: building blocks at
  columns {3,4,6,7,9,10} × rows {0,1,3,4,7,8,10,11}, streets elsewhere (main street rows 5–6 fully
  open); block hexes are building/rubble(rock)/garden(forest)/open by symmetric noise; the central
  market square (cols 6–7, rows 4–7) is raised to elevation 1 and is the `hill`; also provides
  `flags` (same bases as Old Forest), so it supports KotH + CTF. Rocky Pass: rock ridge at elevation
  3 in columns 6–7 with passes only at rows 1, 5, 6, 10; slopes rise 0→1→2 towards the ridge so pass
  hexes are elevation 2 (high ground); 10 boulders on the approaches (kept out of pass mouths); the
  centre pass (4 hexes) is the `hill`. Also fixed `mapToJson` to write objective keys in schema
  order (flags, hill, conquest) — zod's parse reorders them, so insertion order previously broke
  the canonical-format test (caught while authoring the village).
- Task 16: added `maps/twin-towers.json` and `maps/crossroads.json` (14×12, point-symmetric,
  generated by `build-maps.ts`, registered last). Twin Towers: a level-3 plateau (radius 1) around
  each flag base at (3,5)/(10,6), stepping down 3→2→1 in rings; a 4-hex rock wall on the plateau's
  enemy-facing side leaves flank ramps; sparse copses in the centre and a level-1 central rise.
  Flags only (CTF + annihilation). Crossroads: open E–W road (rows 5–6) and N–S road (cols 6–7);
  conquest zones = north road block (cols 5–8 × rows 1–2, 8 hexes), the raised crossing (4 hexes,
  also the `hill`), and the south mirror of the north block; farmland quadrants get
  buildings/forest/rocks/low rises from symmetric noise. Conquest zone order convention for
  built-in maps: zone 2 is self-symmetric, zones 1 and 3 mirror each other — the symmetry test
  now checks this.
- Task 17: resumed an interrupted run (content/protocol/replay-test diff was complete) and finished
  it. `MatchSetup.mapId?` (omitted = legacy flat board; `open-field` yields byte-identical state);
  `configFromSetup`/`createMatchFromPresets` take an optional `MapLookup` (defaults to the built-in
  registry) so task 25 can resolve custom maps; `resolveMap` throws on unknown ids; protocol
  `matchSetupSchema` accepts `mapId` (1–64 chars). Setup screen gained a Map select showing size +
  supported modes; `launchFor` omits `mapId` for the default map so default setups are unchanged.
  Online launches deliberately don't carry a map yet (picker disabled with a hint) — that's task 32.
  Replays already carry the map because `LocalMatchClient.getReplay` records `configFromSetup`.
  Visually checked Rocky Pass in a built preview.
- Task 18: pure editor model in `packages/content/src/editor.ts` (exported from content). Every op
  is `MapDef -> MapDef`, never mutates; the UI previews a stroke on `present` and commits it once
  via `commitEdit` (one undo step; no-op edits skipped; stack capped at `MAX_UNDO` = 100 snapshots —
  maps are ≤ 24×24 so whole-map snapshots are cheap). Undo/redo named `undoEdit`/`redoEdit` to avoid
  generic names in the content barrel. Brushes: `brushCells` (radius clamped 0–2, centre first),
  `regionCells` (offset-coord rectangle between drag corners — used for drag-fill and building
  footprints; the UI decides any footprint cap). Terrain: `paintElevation` raise/lower/set clamped
  0–3, `paintFeature` (undefined removes, elevation kept), `eraseTerrain` flattens + clears feature
  but leaves deploy/objectives alone. Deploy painting steals hexes from the other player so zones
  stay disjoint; conquest painting likewise keeps its 3 zones disjoint. First `setFlag` on a
  flagless map puts the other base at the point-mirror hex (flags are a required pair); an emptied
  hill / all-empty conquest drops the key so JSON stays sparse. Ops never refuse invalid states
  (rock on a deploy hex, empty zone) — `validateMap` errors are shown inline (task 24). Map id
  follows the name via `slugify` (fallback `custom-map`).
- Task 19: `EditorScreen` (apps/web/src/ui) reachable via a "Map editor…" button under the Setup
  map picker; Back returns to Setup. Holds an `EditorHistory` (starts as a 14×12 `newEditorMap`);
  "New map" takes width/height clamped to `MAP_LIMITS` (`clampMapSize`) and resets history + keeps
  the name. Rendering reuses `BoardCanvas` with a new `liveTerrain` prop: when set, a changed
  `state.board` reference rebuilds the terrain (off in play, because reduce clones the board every
  command). `BoardView.buildBoard` is now re-callable — it disposes the old tiles/feature meshes and
  only re-frames the camera when the board size changes. The preview state is
  `createGame` with empty warbands (`mapPreviewState`, tested). Clicking a hex selects it (green
  highlight via `moveTargets`, details in the side panel). Deploy zones/objectives aren't drawn yet
  (task 23). Checked with Playwright on a built preview: select, resize 8×40→8×24, back to Setup.
- Task 20: editor Terrain tools — Select / Raise / Lower / Set (level 0–3) / Erase, brush radius
  0–2 (`MAX_BRUSH_RADIUS`). Pure `applyTool(map, tool, cell, radius)` + `EditorTool` type live in
  `apps/web/src/ui/editorView.ts` (tested); every click is one `commitEdit` (no-op/off-board clicks
  add no undo step). Painting is click-per-hex for now: left-drag orbits the camera, so drag gestures
  are left to tasks 21/22 (which need drag for footprints/fills). Default tool is Raise so the editor
  is immediately useful; clicking also selects the hex for the details panel. Checked with Playwright.
- Task 21: editor Features → Building tool. Click toggles a single-hex building (ignores brush radius,
  keeps elevation, replaces any other feature); drag stamps the offset-rectangle footprint between
  the press and release hexes, far corner clamped so each side ≤ `MAX_FOOTPRINT_SIDE` = 4, one undo
  step on release, previewed as highlighted hexes while dragging. Drag gestures: `BoardView.setCellDrag`
  (via `BoardCanvas.onCellDrag`, set only while a drag tool — `toolDrags` — is active) remaps
  OrbitControls so left-drag paints, middle-drag orbits, right-drag pans; a press that barely moves is
  still a click. Off-board pointer keeps the last in-board corner. Pure helpers (`applyDrag`,
  `dragCells`, `footprintCells`) in editorView.ts, tested; task 22 extends `toolDrags`/`dragCells`
  for forest/rock fills. Checked with Playwright on a built preview.
- Task 22: editor Features → Forest / Rock tools (`EditorTool` `{ kind: 'area', feature }`). Click paints
  the brush (radius 0–2) — or, when the centre hex already has that feature, clears it from the brush
  hexes that have it (other features untouched), so radius 0 is single-hex place/remove. Drag fills the
  full offset rectangle (`regionCells`, uncapped, radius ignored) as one undo step; a drag started on
  that feature clears it from the region instead. Painting over a building replaces it (same as
  `paintFeature`). Tested in editorView.test.ts; checked with Playwright on a built preview.
- Task 23: editor "Zones & objectives" tools — Deploy P1/P2, Hill, Zone A/B/C (`EditorTool`
  `{ kind: 'zone', zone: ZoneId }`) paint with the brush on click and fill the offset rectangle on
  drag, toggling like forest/rock (click/drag started inside the zone removes). Disjointness comes
  from the content ops (deploy steals from the other player; conquest zones steal from siblings; the
  hill may overlap anything). Flag P1/P2 click moves that base (first flag mirrors the other; brush
  ignored, no drag); "Remove flags" button clears the pair. Zones/objectives render via a new
  `BoardViewModel.overlays` (tinted flat hexagons; flags as small solid hexes on top, player colours),
  built by pure `mapOverlays(map)`; the selected-hex panel lists memberships (`hexMarkings`). Tested
  in editorView.test.ts; checked with Playwright on a built preview.
- Task 24: editor header now has a Name field (uncontrolled, keyed on `map.name` so undo/redo resets
  it; commits on blur/Enter via pure `applyMapName` — trims, collapses spaces, caps at `MAX_MAP_NAME`
  = 40, blank keeps the old name; id re-slugs; one undo step), the map id/size, and Undo/Redo buttons
  (disabled via `canUndo`/`canRedo`) plus Ctrl/⌘+Z, Ctrl/⌘+Y, Ctrl/⌘+Shift+Z (`historyShortcut`;
  ignored while typing in a field). Below it an inline validation panel (`editorValidation`): green
  "Valid · modes: …" (via `supportedModes`) or the `validateMap` errors reworded to editor labels
  (`editorErrorText`: player 0/1 → P1/P2, conquest zones 1–3 → A–C), capped at 6 + "…and N more".
  `MODE_LABELS` moved from SetupScreen into editorView.ts (shared). Tested; checked with Playwright.
- Task 25: custom maps. `apps/web/src/game/customMaps.ts` (tested, storage injected — `MapStorage`, `null` =
  unavailable) keeps editor maps as one JSON array under localStorage key `fansong.customMaps`; entries
  are untrusted and go through `parseMapJson` (zod `parseMap` + size limits + hex count, so the editor
  can render them); corrupt storage/entries are skipped, never thrown. Saving upserts by id (the name
  slug), and a custom id that collides with a built-in gets `-custom` appended (`customMapId`) so it
  never shadows one. Only maps passing `validateMap` are playable: Setup lists them in a "Custom"
  optgroup after the built-ins, and `customMapLookup` resolves them for `LocalMatchClient`, which now
  takes a `MapLookup` and builds its `GameConfig` once (replay stays right even if the map is later
  edited/deleted). Editor "Save & load" panel: Save, Export .json (`mapToJson`, `<id>.json`, via a new
  generic `downloadJson` in replay-io.ts), Import .json…, saved-map select + Load/Delete; load/import
  confirm before discarding edits (only when there is undo history), delete always confirms. Online
  still plays the default map (task 32). Checked with Playwright on a built preview: save/export/import
  (good + bad file)/load, custom maps in the Setup picker, and a match started on one.
- Task 26: engine mode model in `mode.ts`. `GameConfig.mode`/`objectives` (`ModeObjectives` mirrors content
  `MapObjectives`); `createGame` attaches `GameState.mode = { mode, objectives, scores }` only for
  non-annihilation modes (explicit `mode: 'annihilation'` serialises identically to none), keeping just the
  objectives the mode uses and throwing when they're missing. `MODE_RULES`: KotH target 5, conquest 8, both
  capped at `ROUND_LIMIT` = 12; CTF and kill-the-king have **no** round cap (spec only caps the zone modes).
  The cap fires in `endRound` before the round counter increments, so a capped game ends with `round` = 12.
  Tiebreak (`tiebreakWinner`): more living units → more standing units → higher summed combat of the living
  → player 1 (player 0 had first initiative). No draws, `winner` stays `Owner`. New helpers `awardPoints`
  (emits `ScoreChanged`, ends at target), `checkRoundLimit`, `finishGame`. `GameOver` gains an optional
  `reason` ('annihilation' | 'score' | 'roundLimit' | 'king' | 'flag') emitted **only** in objective modes,
  so annihilation events are unchanged. Protocol state/event schemas + drift guards extended; CLI/web log
  got a basic `ScoreChanged` line (polished in task 39).
- Task 27: kill-the-king. `UnitSpec.king?: boolean`; in kill-the-king mode `createGame` requires **exactly one**
  King per warband (throws otherwise — content/setup picks the default in task 31) and records them as
  `ModeState.kings: [p0 id, p1 id]` rather than a `Unit` field, so the unit shape/schema is untouched and the
  flag is simply ignored in every other mode. `checkGameOver` checks `fallenKingOwner` before annihilation: a
  King that is dead — killed in combat *or routed* (rout removes the unit, which counts as falling) — loses at
  once with `GameOver.reason: 'king'`. One combat only ever costs one side units, so both Kings can't fall
  together; the scan is in unit order anyway. Helpers `kingOf`, `isKing`, `fallenKingOwner`. Protocol
  `modeStateSchema` gains optional `kings`. The task-26 test that used kill-the-king for the "annihilation
  reason" case now uses king-of-the-hill (kill-the-king needs Kings now).
- Task 28: king-of-the-hill scoring. "Start of each round" is implemented as every round boundary: `endRound`
  calls `scoreZones` first (before the round-cap check and before `RoundEnded`), so points land at the start
  of rounds 2…12 **and** once more as round 12 ends, before the game is called on points — otherwise
  holding the hill during the last round would count for nothing. Round 1's start (straight after deploy) is
  not scored. Controller = strictly more standing (living, not knocked down) units on the zone's hexes; a tie
  or empty zone scores nothing and emits no event. Reaching 5 ends the game at once (`reason: 'score'`) and
  no `RoundEnded` follows. New helpers `standingInZone`, `zoneController`, `scoringZones` (hill only for now;
  conquest's three zones plug in there in task 29), `scoreZones`. No schema change (reuses `ScoreChanged`).
- Task 29: conquest. `scoringZones` returns the three conquest zones; each is scored separately (+1 to its
  controller, same strict-majority-of-standing-units rule as the hill) at every round boundary. `ScoreChanged`
  gains an optional `zone` index, emitted **only** for conquest (KotH events unchanged); protocol schema + web
  log updated. Decision: `scoreZones` now tallies every zone before checking the target, so zone order never
  decides a game — if both players reach the target on the same boundary the higher score wins, and an equal
  score goes to `tiebreakWinner` (reason still `'score'`). KotH behaviour is identical (one zone).
- Task 30: capture-the-flag. `ModeState.flags: [FlagState, FlagState]` (player 0's and player 1's flag), each
  `{ at, carrier }`; `at` tracks the carrier's hex while carried so renderers need no lookup. Only a Move's
  **destination** counts (passing over a flag does nothing). After each move (`flagsAfterMove`): a carried flag
  follows; ending on your own *dropped* flag returns it to base (`FlagReturned`); ending on the enemy flag — at
  its base or dropped — picks it up (`FlagPickedUp`, incl. a carrier grabbing its own dropped flag back on the
  way home, which is a return); a carrier ending on its own base captures (`FlagCaptured`, score +1, `GameOver`
  reason `'flag'`, no `ActivationEnded`). Decision: capturing does **not** require your own flag to be home
  (spec doesn't ask for it). Drops (`dropFallenCarriers`) run at the top of `checkGameOver`, i.e. after every
  attack/shot/riposte and every activation hand-off, so a carrier knocked down, killed or routed drops on its
  hex before the turn passes (`FlagDropped` carries `at`). A knocked-down carrier that stands up does not
  re-take a flag lying under it — it must move off and back (pickup is by moving onto). No round cap for CTF.
  Protocol: `flagStateSchema` + four flag event schemas + drift guard; CLI/web logs got basic flag lines.
- Task 31: mode wiring. `MatchSetup` gains optional `mode` and `kings: [number, number]` (index into each
  preset's units); `MatchOptions` the same, handled in `buildMatch`. Annihilation (explicit or omitted) adds
  no config keys, so legacy configs/replays are unchanged. Objective modes (KotH/conquest/CTF) require a map
  and run `validateMap(map, mode)`; only the objective key that mode uses is copied into `config.objectives`.
  Kill-the-king works on the legacy board or any map; its King defaults to `defaultKing(units)` = the most
  expensive unit by `unitCost` (first on a tie) — decision, the spec only says "designated during deploy";
  the Setup UI (task 37) will let players pick. Out-of-range King indices throw. Protocol `matchSetupSchema`
  got `mode`/`kings` already here because the drift guard ties it to `MatchSetup` (task 32 does messages/room).
- Task 32: protocol/worker map + mode. Protocol gains `matchmakeRequestSchema` (the `POST /api/matchmake`
  body): queue `mode` pve/pvp + presets + seed + optional `mapId`, `gameMode`, `kings`. Decision: the game mode
  field is named `gameMode` because `mode` already means the queue there; the pure `Matchmaker` copies it into
  `MatchSetup.mode` via new `setupFor` (keys only when present, so plain requests give the pre-map setup). A pvp
  joiner still plays the host's setup verbatim (map/mode included). The MatchmakerDO now zod-parses the body
  instead of a cast, and both DOs reject unplayable setups with 400 via new `setupError(setup)` in room.ts (runs
  the real `createMatchFromPresets`, so unknown preset/map, mode unsupported by the map, bad King index are all
  caught before a room is seeded). Online play is limited to **built-in** maps: the worker can't see a browser's
  custom maps, so `launchFor('online', …)` only carries a built-in non-default `mapId` (custom → default board).
  The web `Launch` online variant and `connectOnline` pass `mapId/gameMode/kings` through; the Setup UI has no
  mode picker yet (task 37). The room itself needed no change — `welcome.setup` already carried the fields.
- Task 33: AI zone play (KotH + conquest). `chooseCommand` builds a per-decision zone view from engine
  `scoringZones`/`standingInZone`; outside the zone modes it is empty and every score is exactly as before
  (golden replay untouched). A unit is a *holder* when it stands in a zone its side wouldn't hold outright
  without it: it activates late, Guards (10) or ends, and never moves (in-zone shuffle -1, leaving -1000).
  Anyone else targets the nearest zone its side doesn't hold outright (tie → most units needed): stepping
  in scores 130k (beats a shooter's 120k standoff), otherwise closing hex distance replaces enemy distance
  in both activation choice and moves. Attacks/shots still outscore everything. When every zone is held,
  spare units hunt enemies as in annihilation. Decision: hex distance, not path distance, to zones (simple;
  maps are open enough). No coordination between units, so several may converge on one conquest zone.
  Tests: ai/test/zones.test.ts (unit behaviours) + map self-play in each built-in KotH/conquest map
  (completes ≤ round 12, ≥ 6 score events over 3 seeds; observed 10–41).
- Task 34: AI capture-the-flag. In CTF `chooseCommand` switches to `scoreFlagCommand` (other modes untouched,
  golden unchanged). Uses **walking distance** (BFS field over passable hexes, new `distanceField`) rather
  than hex distance, since Twin Towers' rock walls would otherwise trap units. Our carrier activates first,
  steps onto its base to win (2M), and any step closer to home beats fighting (1.1M > attack 1M). Everyone
  else heads for the nearest goal — the enemy flag if free, our own dropped flag, or the enemy carrier —
  and stepping onto the enemy flag (1.5M) or our dropped flag (1.4M) beats any attack; attacks/shots on the
  enemy carrier get +200k. With no goal left (we carry theirs, ours is home) the rest fight as in
  annihilation, which escorts the carrier implicitly. Decision: no defenders are held back and shooters
  don't keep their standoff in CTF (simple; the flag is the point). Dice policy pulled into `diceScore`.
  Tests: ai/test/flags.test.ts + CTF self-play on each built-in flag map (3 seeds; observed pickups/captures
  old-forest 4/1, ruined-village 6/2, twin-towers 8/3).
