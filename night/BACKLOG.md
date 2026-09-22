# Night build backlog

Ordered; take the first unchecked, unblocked task. See SPEC.md for the full spec.

Ground rules carried by every task: the default (flat, featureless, annihilation) game
must serialise to exactly the same `GameState` JSON as before, so the golden replay hash
is untouched — new state is **optional/sparse** and omitted when default.

## Engine model & rules
- [x] 1. Engine: sparse terrain in `BoardData` (optional per-hex `elevation` 0–3 and `feature`
      rock/building/forest), `Board` accessors (`elevation`, `feature`, `isPassable`), `GameConfig`
      pass-through; test that a default game's state JSON has no new keys.
- [x] 2. Engine: LOS with features — rock/building block, forest blocks *through* but not into/out of;
      legacy `blocked` still blocks; tests incl. symmetry and edge-graze determinism.
- [x] 3. Engine: movement pathing — a Move destination must be reachable in ≤ `move` steps over
      passable hexes (BFS around rocks/buildings/legacy blocked; units don't block paths so the
      golden is unchanged). Legal moves use the same reachability. Tests.
- [x] 4. Engine: high ground +1 (melee attack, guard riposte, shoot) for a standing combatant on a
      higher hex; optional bonus fields on combat events only when non-zero. Tests.
- [x] 5. Protocol: extend board/config zod schemas with terrain; round-trip tests.
- [x] 6. CLI: ASCII board shows features (`^` rock, `B` building, `T` forest) and elevation.

## Rendering
- [x] 7. Web: hexes extruded by elevation with shaded side faces; units and picking sit on top.
- [x] 8. Web: low-poly feature meshes — rock clusters, boxy buildings (connected where adjacent), cone trees.
- [x] 9. Web: hex hover tooltip/HUD shows elevation + feature; combat log mentions high ground.

## Map format
- [x] 10. Content: `MapDef` type + zod schema (id, name, width, height, hexes, deployZones, objectives).
- [x] 11. Content: `validateMap` — size limits, hex count, deploy zones on passable hexes with room
      for a warband, objectives valid per mode; `supportedModes(map)`. Tests.
- [x] 12. Content: `mapToBoard` + deploy warbands into map deploy zones; `buildMatch` accepts a map;
      the default flat map reproduces the legacy config exactly. Tests.
- [x] 13. Content: built-in map registry loading `packages/content/maps/*.json` (`listMaps`/`getMap`).

## Premade maps (each: validates + AI-vs-AI annihilation self-play test; mode tests added in 36)
- [x] 14. Maps: Rolling Hills, Old Forest.
- [x] 15. Maps: Ruined Village, Rocky Pass.
- [x] 16. Maps: Twin Towers, Crossroads.
- [x] 17. Setup: `MatchSetup.mapId`; map picker in Setup screen; replays/config carry the map.

## Terrain editor
- [x] 18. Editor: pure editor model (new map, brushes, stamps, undo/redo stacks) with tests.
- [x] 19. Editor screen reachable from Setup: new map (size), render via BoardView, hex picking.
- [x] 20. Editor: elevation brushes (raise/lower/set) + erase.
- [x] 21. Editor: buildings — click single hex, drag to stamp a multi-hex footprint.
- [x] 22. Editor: forest & rocks — brush radius 0–2, drag-fill region, single place/remove.
- [x] 23. Editor: deploy zones per player; objectives (flag bases, hill zone, conquest points).
- [x] 24. Editor: undo/redo UI, map name, inline validation errors.
- [x] 25. Editor: save/load localStorage, export/import .json; custom maps in Setup picker.

## Game modes
- [x] 26. Engine: mode model — `GameConfig.mode`/objectives, optional state (omitted for
      annihilation), scores, round-12 limit + annihilation-style tiebreak helper. Tests.
- [x] 27. Engine: kill-the-king — `UnitSpec.king`, king death = immediate loss. Tests.
- [x] 28. Engine: king-of-the-hill scoring at round start, first to 5, round-12 end. Tests.
- [x] 29. Engine: conquest — 3 zones scored separately, first to 8. Tests.
- [x] 30. Engine: capture-the-flag — pickup/drop/return/capture + events. Tests.
- [x] 31. Content: mode wiring — `MatchSetup.mode`, map objectives → engine config, king designation.
- [x] 32. Protocol/worker: map + mode in match setup messages; room uses them. Tests.

## AI
- [x] 33. AI: king-of-the-hill & conquest — move to/hold zones.
- [x] 34. AI: capture-the-flag — fetch flag, carry home, return dropped flag, hunt carrier.
- [x] 35. AI: kill-the-king — protect own king, focus enemy king; high ground/LOS awareness.
- [ ] 36. Self-play: every built-in map × each supported mode completes; objective sanity checks.

## Mode UI
- [ ] 37. Setup: mode picker filtered by map support; king selection for kill-the-king.
- [ ] 38. HUD + board markers: mode, scores, flag carrier, flags, zones, crown.
- [ ] 39. Log text + light animation for scoring / flag events.

## Polish
- [ ] 40. CLI: `--map` / `--mode` flags; `--list` shows maps.
- [ ] 41. Docs: PLAN.md M7 section + README usage.
- [ ] 42. Final pass: full test run, build, small fixes.
