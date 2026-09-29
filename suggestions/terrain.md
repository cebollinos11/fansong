# Terrain suggestions

## How terrain works now

The board has three features and an elevation layer:

- **Rock** and **building** can't be entered and block line of sight.
- **Forest** can be entered. It blocks sight *through* it and gives −1 cover
  against shots at a unit inside it.
- **Elevation** runs from 0 to 3. Climbing it is free, and the higher unit gets
  +1 in combat.

Everything else is uniform: every hex costs the same to move through, and a unit
pushed into terrain simply falls.

The combat system already makes position matter a lot: pushes, falls, deaths
off the map edge, outnumbering, and activation dice where a bad roll ends your
round. The strongest terrain ideas plug into those rules rather than just adding
walls. They are listed strongest first.

## Tier 1: small engine changes, big effect on play

### 1. Deadly drops (chasm, deep water, lava, cliff edge)

> **Lava is implemented** (see the README's terrain section and the Ember Rift
> map). It differs from the sketch below in two ways: Tough does *not* save a
> unit pushed in, and flyers *may* end a move on it — but a flyer knocked down
> over lava falls in and dies. Chasm or deep water can reuse the same rules
> (`isDeadlyFeature` in `packages/engine/src/board.ts`).

A unit pushed into one dies, the same as being pushed off the map (Tough turns
it into a fall). This is probably the single best addition. Every melee next to
a hazard becomes a fight over which way the loser gets pushed, and "stand with
your back to the river" becomes a real decision.

- It reuses the off-map push path in `packages/engine/src/reduce.ts`.
- Flyers can cross it but never end a move on it.

### 2. Difficult ground (marsh, rubble, shallow water, and optionally forest)

Entering one of these hexes costs 2 movement, and a unit fighting from it gets
−1. This is already listed as a gap in [RULES_GAP.md §2.4](../RULES_GAP.md).

- It creates routes that are fast but exposed next to routes that are slow but
  covered.
- Fast units get a reason to stay on open ground.
- `moveReach` in `packages/engine/src/query.ts` needs to become a cost-weighted
  search instead of a step count.

### 3. Real cliffs

- Climbing up by 1 costs +1 movement.
- A height change of 2 or more is impassable except by a ramp or stairs.
- A unit pushed down a drop of 2 or more falls, or dies if it was already down.

Hills then become fortresses with a few ways up that can be defended, instead of
free +1 bonuses.

## Tier 2: new decisions for players

### 4. Terrain that changes activation

The core twist is activation dice against Quality, with a failure ending your
round, so terrain that touches this is unique to FanSong:

- **Bog or treacherous ground:** activating here is at Quality +1, so a turnover
  is more likely.
- **Shrine, banner stone or watchtower:** a unit on or next to it may reroll one
  failed activation die.
- **Haunted ground or graveyard:** fear tests here take −1, or gruesome kills
  here trigger fear from further away.

This gives players map objectives worth holding that aren't just victory points.

### 5. Tall grass or brush

It doesn't block sight through it the way forest does, but a unit inside can
only be shot from 2 hexes or closer. This is a cheap way to make ambushes work
and to weaken long-range shooters.

### 6. Roads

A move that stays entirely on road gets +1 or +2 hexes. It gives flanking and
reinforcing an obvious fast lane that the enemy can see coming.

## Tier 3: bigger features

### 7. Walls, hedges and fences on hex edges

- A defender behind one gets +1 in melee against an attacker coming across it,
  and counts as in cover against shots.
- Crossing one costs an extra action.

This is the classic wargame feature, but it needs edge-based terrain data: a new
layer alongside the per-hex `terrain` map in `packages/engine/src/board.ts`.

### 8. Enterable buildings with doors

A unit inside is immune to fear and hard to shoot, and can only be entered
through its door hexes. Buildings become chokepoints that can be garrisoned,
instead of plain rocks.

### 9. Terrain that can change

Examples: burning forest that spreads, a bridge that can be broken, a door that
can be barred. This is fun but touches the most systems.

## Recommended first batch

**1 (deadly drops) + 2 (difficult ground) + 4 (activation terrain).** Together
they give the maps hazards that push the fight around, lanes where movement is
slow, and objectives worth holding. Each change stays in one place:

- `isImpassableFeature` / `blocksSight` in `packages/engine/src/board.ts`
- `walkRules` / `moveReach` in `packages/engine/src/query.ts`
- push resolution in `packages/engine/src/reduce.ts`
- activation

A smaller start is chasm/water plus marsh.

## Work needed beyond the engine

Any new feature also needs work in three places:

- **AI:** it has to value pushing enemies toward hazards and avoid bad ground,
  or it will blunder into both.
- **Maps and editor:** the eight built-in maps and the map editor need the new
  features.
- **Hex info tooltip:** players need to see what each hex does, or the rules
  will feel arbitrary.
