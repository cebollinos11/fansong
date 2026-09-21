# Night build spec

## Invariants (never break)
- Engine stays pure and deterministic. All new rules go through reduce/getLegalCommands.
- Default map = flat, no features; default mode = "annihilation". The existing golden
  replay (packages/engine/test/fixtures/golden-replay.json) must still pass byte-for-byte.
- `pnpm test` and `pnpm typecheck` green before every commit.

## 1. Elevation
- Each hex has an integer elevation 0–3 (default 0).
- High ground: in melee or ranged combat, a combatant who is NOT knocked down and stands on a
  higher hex than their opponent gets +1 to their combat roll. Applies to attacker and defender alike.
- Elevation does not change movement cost or LOS (keep it simple).
- Rendering: hexes extruded/offset by elevation with visible side faces or shading; units sit on
  top of their hex. Show elevation in the hex tooltip/HUD.
- Combat log / result events mention the high-ground bonus when it applies.

## 2. Terrain features (one per hex)
- `rock`, `building`: impassable, block LOS.
- `forest`: passable, blocks LOS *through* it. A unit inside a forest hex can see and be seen
  from outside, but LOS cannot pass through a forest hex to reach another hex beyond it.
- LOS = hex line between centres (cube-coordinate lerp, nudge ties consistently); any
  intervening blocking hex blocks. Ranged attacks and any existing LOS rules use it.
- Distinct 3D visuals per feature (simple low-poly meshes fine: rocks, boxy buildings, cone trees).

## 3. Map format
- JSON `MapDef { id, name, width, height, hexes: {elevation, feature}[], deployZones, objectives }`
  with a zod schema + validation (size limits, deploy zones on passable hexes, objectives valid for mode).
- Built-in maps in packages/content/maps/*.json.

## 4. Six premade maps
Each uses a distinct mix of features and supports at least one game mode:
1. Rolling Hills (elevation-heavy, few features)
2. Old Forest (dense forest, LOS play)
3. Ruined Village (buildings + streets)
4. Rocky Pass (rocks + chokepoints + ridge)
5. Twin Towers (two raised plateaus, good for CTF)
6. Crossroads (3 objective zones, good for conquest)
Each map gets a test: it validates, and an AI-vs-AI self-play game completes on it in each supported mode.

## 5. Terrain editor (web app, new screen reachable from Setup)
- New map (choose size), paint elevation (raise/lower/set brush), erase.
- Place buildings: click to drop a single-hex building, or drag to stamp a multi-hex building
  footprint (e.g. a 2–4 hex block); buildings render as one connected structure where adjacent.
- Place forest areas: area brush (brush radius 0–2) and/or drag-fill a region to paint forest in
  bulk; also single-hex placement and removal.
- Place rocks the same way (single hex or brush).
- Place deploy zones per player; place objectives (flag bases, hill zone, conquest points).
- Undo/redo, name the map, inline validation errors.
- Save/load to localStorage; export/import as .json file download/upload.
- Custom maps appear in Setup's map picker alongside built-ins.

## 6. Game modes (chosen in Setup; the map must support the mode)
- annihilation (existing behaviour, default).
- capture-the-flag: each player has a flag on their base hex. A unit moving onto the enemy flag picks
  it up; if the carrier is knocked down or killed the flag drops on its hex; a friendly unit moving
  onto its own dropped flag returns it to base. Win when your carrier ends a move in your base.
- king-of-the-hill: one zone (set of hexes). At the start of each round, the player with more
  standing (not knocked down) units in the zone scores 1 point. First to 5 wins; otherwise the
  higher score after round 12 wins (tie → annihilation-style tiebreak).
- conquest: as KotH but with 3 zones, each scored separately. First to 8, or the higher score after round 12.
- kill-the-king: each player designates one unit as King during deploy (rendered with a crown
  marker). Your King dying = you lose immediately.
- HUD shows mode, scores, flag carrier. Engine emits events for scoring/flag pickup/drop/return/capture.
- The heuristic AI must pursue objectives in every mode (move toward flags/zones, protect its king).
- Protocol/online: map + mode are included in match setup messages.
