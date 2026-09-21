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
