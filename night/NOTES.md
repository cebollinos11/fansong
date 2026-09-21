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
