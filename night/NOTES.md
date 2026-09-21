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
