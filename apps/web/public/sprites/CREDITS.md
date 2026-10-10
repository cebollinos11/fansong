# Sprite credits

The unit sprites and animation frames under `units/`, the missiles under
`projectiles/`, the animated lava and grass hexes under `terrain/`, and the
signs of the run map's places under `items/` and `scenery/` (a sword, a flaming
sword, a merchant's tent, a campfire, a training dummy, a signpost and a dragon
statue), are from [Battle for Wesnoth](https://www.wesnoth.org/)
(`data/core/images/` in https://github.com/wesnoth/wesnoth), by the Wesnoth
artists, and are licensed under the GNU General Public License, version 2 or later.
The animation timings in `src/three/unitAnimations.json` are derived from the
same project's unit definitions (`data/core/units/`).

The images are used unmodified; team colours are applied at runtime, the lava
frames are cropped at runtime to the part that repeats, and the meadow backdrop
scatters the grass hexes at runtime. Re-import them
from a local Wesnoth checkout with `pnpm --filter @fansong/web sprites [path/to/wesnoth]`
(the unit -> sprite mapping lives in `src/three/unitSprites.ts`).
