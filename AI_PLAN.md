# AI plan: from reflexes to tactics

Goal: an opponent that plays "move A here so B can flank", holds a line, focuses fire and avoids being swarmed, without hand-written rules for any of those.

## Where the AI is today

`chooseCommand` (`packages/ai/src/index.ts`) is a stateless, one-command greedy scorer. Each call scores every legal command and takes the best.

- It scores the **command**, never the position it leaves behind.
- A fixed ladder decides the kind of action: Attack (1,000,000) > Shoot (900,000) > Move (100,000) > Guard > End. A unit that can attack always does.
- A plain move closes on the nearest enemy. `chargeEdge` looks at the mover's own next blow, never at a friend's.
- Activation order is "whoever can fight now goes first", so a unit that should set up a friend never goes ahead of it.
- Nothing models the enemy's reply.
- Team awareness is limited to dice count (`diceWorth`), groups, war cry and the mode plans (`assignZones`, `kingPlan`, `flagPlan`).

## The idea

Score the position a command leaves behind, with two numbers read from the engine's own odds:

- **Threat**: what our units can expect to do to the enemy from here.
- **Exposure**: the same, for the enemy against us.

A move is worth `Δthreat − w × Δexposure`. `combatOdds` already counts pincers, outnumbering, shieldwalls, high ground, lava and every trait, so stepping A behind X raises B's odds on X, and A's move scores higher for it. A new trait or rule that changes the odds is picked up with no change to the AI.

## Rules for every phase

- **Deterministic and stateless.** No `Math.random`, no clock, no state kept between calls except pure caches keyed by the inputs they depend on. Ties still break toward the earlier legal command. `selfplay.test.ts` checks this.
- **Only legal commands.** The AI still picks from `getLegalCommands`. Hypothetical positions are for scoring only.
- **Never roll dice to look ahead.** Build a hypothetical state by copying the units with one position changed (as `attackSetup` in `reduce.ts` does). `reduce` would spend the RNG and resolve free hacks.
- **Measure, don't eyeball.** Each phase is kept only if the bench says so (see Phase 0). Past weights that "looked right" measured as no-ops.
- **One phase per commit**, each with its measured win rates in the commit body.
- **Budget.** Phase 0 records today's decision time on `stone-crown` (40×40). After each phase: mean at most 3× that figure, and no single decision over 100 ms.

## Phase 0: a permanent bench

The bench is a throwaway script today; every later phase needs it.

- Add `pnpm play bench` in `tools/cli` (a `bench.ts` beside `runSim.ts`).
- It plays the current AI against a baseline module given by `--baseline <path>` (any module exporting `chooseCommand`). With no baseline it plays the AI against itself and must report exactly 50%.
- Matches come from `createMatchFromPresets`: per mode, across maps, presets and seeds, both seat orders on the same seed.
- Options: `--modes`, `--maps`, `--presets`, `--seeds`, `--jobs` (parallel processes).
- Output per mode: games, win rate, ± margin, draws or timeouts, and decision time (mean, p95, max) for each side.
- A `--self` check per preset (baseline vs baseline), to tell a weak warband from a weak AI. `thorn-patrol` is known to be weak.
- Baseline: the committed AI's whole source, frozen into the gitignored `packages/ai/baseline/` (the commands are in `CLAUDE.md` and `pnpm play bench --help`). Never commit it. A single `baseline.ts` copied from `index.ts` did for Phase 1, but from then on the AI is several files.
- Presets only meet others within 20% of their points (a walkover says nothing about the AI), mirrors included: 39 pairs on 11 maps, so one seed is 858 games per mode.
- Update "Changing the AI" in `CLAUDE.md` to name the command.

Done when: self-play reports 50.0% in every mode, and the baseline decision times are written into this file.

## Phase 1: setup value for moves (annihilation only)

New file `packages/ai/src/tactics.ts`.

- `withUnitAt(state, unitId, pos)`: the hypothetical state.
- `threat(state, board, side)`: for each enemy target, combine the blows our units can bring against it.
  - A unit's blow on a target counts if the target is adjacent (one action), within a charge (move then strike, two actions) or within its range (a shot). Use `multiMoveReach` from the engine's `plan.ts` if it works for a unit that is not active; otherwise a distance bound.
  - Weight each blow by the odds the unit gets the actions it needs (`successOdds`, the unit's Quality, inspired or not). A unit that has already activated this round counts for next round at a discount.
  - Combine per target, not by plain sum: `worth × (1 − Π(1 − pKillᵢ))` plus the lesser-hit share. This rewards focus fire and stops three units all "claiming" the same kill.
  - Reuse `blowValue` and `worthOf` for the values.
- `exposure` is `threat` seen from the other side.
- In `scoreCommand`'s plain `Move` case (no zones, no king plan, no flags), add `SETUP_SCALE × (Δthreat − EXPOSURE_WEIGHT × Δexposure)` to the existing score. The ladder stays for now.
- Pruning: give the full evaluation only to destinations that change some unit's contact, charge reach or shooting range; the rest keep today's score. Cache per `chooseCommand` call.

Tests (`packages/ai/test/tactics.test.ts`, built like the existing ones):
- A can reach either side of an enemy that B is fighting; it takes the hex that gives B the pincer.
- A melee unit does not step to a hex three enemies can charge when an equally near hex is covered by friends.
- A shooter keeps its standoff (no regression).

Done when: ≥ 54% vs baseline in annihilation at ~800 games (margin ±3.4%), no other mode below 46%, budget met. If it measures as noise, find out why before going on: check that `Δthreat` is non-zero in the test scenes and try a wider `SETUP_SCALE`.

Done: 61.9% ±3.2% in annihilation, at `SETUP_SCALE` 1,000 (the same as `CHARGE_SCALE`) and `EXPOSURE_WEIGHT` 1, the first values tried; no sweep was run. What was built differently from the list above:

- **Reach is a distance bound**, not `multiMoveReach`: a walk on `stone-crown` costs about half a millisecond, and a move decision would need one per unit. So a charge counts when a free hex beside the target lies within one Move as the crow flies; rock in the way and foes that would stop the charge are not seen. Worth another look in Phase 3, where `getActionPlans` walks for the active unit anyway.
- **A blow its unit would lose by counts for nothing**, and a target's total is never negative. Between equal units a lone charge is such a blow, so exposure only shows where the enemy is stronger, outnumbers, or has several units in reach.
- **Each blow is scored on its own**: a first blow that knocks the target down does not make the second one deadlier, and a unit that can reach three targets threatens all three.
- **The active unit counts as spent**: its blows from the new hex are next round's. What it can strike with the actions it still holds stays `chargeEdge`'s business.
- **Scoring is incremental** (`MoveSetup`): only the blows a destination can change are worked out again, and a test holds the result to `threat(withUnitAt(...)) - threat(state)` for every legal move. The risk to the mover itself, the costliest part, is only worked out for the moves that could still be the best; it is never negative, so the choice is the same as if every move had been scored in full.
- **Two changes to the engine, for speed only**: `combatOdds` takes the caller's `board`, and counts the 36 rolls of a match-up once (`rollTally`). The first cut of this phase took 27 ms a decision; these and the incremental scoring brought it to 3.
- **Zone modes are left out entirely**: a unit with no zone to go to still hunts as before. With the term on for those hunters, hill measured 53.1% and conquest 50.5%, both inside the margin. Phase 4 can take it up.

## Phase 2: activation order

The setter must go before the finisher.

- For each unit not yet activated: `own` = the best it can do itself now; `gift` = the most its best move adds to its friends' threat; `wait` = how much its own best blow would gain if a friend set it up first.
- Activation score follows `own + gift − wait`, in place of the "can fight now" rule. Keep `leaderFirst`, the dice policy (`diceWorth`) and group activation as they are.
- Bound the cost: only look at friends within charge reach of the same target.

Tests: with B already in contact and A able to flank, A activates first; with no setup on offer, the order is as today.

Done when: ≥ 54% vs the Phase 1 AI in annihilation, others not below 46%.

Kept, but short of the bar: 52.2% ±1.9% in annihilation over three seeds (52.8%, 52.7%, 51.0%), a real gain and a small one. What was found, and what was built differently:

- **Why it is small.** The new order picks another unit than Phase 1 in about 30% of activations, nearly all for a gift, but the setter delivers in only about half of them. About 29% of the time it rolls no action: the dice policy often gives it one die, while `gift` assumes two. About 16% of the time it does not arrive: the move scoring finds the hex too risky, or there is no legal hex because reach is a distance bound. Most often it moves in and does not strike, so the gain is only the friend's better blow this round, while that blow is put off by one enemy activation every time.
- **The terms cannot be told apart.** Over the same three seeds, Phase 1's `own` with `gift − wait` measured 53.5%, and `own + gift` with no `wait` 53.3%: all within the margin of each other. The plan's formula is the one kept.
- **Shooters and spellcasters give nothing**: they never step into contact, and were about 15% of the setters chosen in the first cut.
- **Only friends still to activate count**: one that has gone strikes next round whoever goes first now.
- **`gift` is worked out with `blowOn`, not `MoveSetup.partial`**: per foe in reach, only the nearest free hex beside it and the hexes that close a pincer are scored, since outnumbering is the same from any of them. A `MoveSetup` per unit would score the whole board for each. The order costs about 0.45 ms an activation decision.
- **`own` counts a winning charge or shot**, not only a blow in contact, so such a unit joins the fighters' band of activation scores.
- **Next to try**: let a unit chosen for its gift roll two dice (the 29%). The setters that never arrive should come right in Phase 3, which plans the move and the strike together.
- **Tried, not kept: making the dice and the gift agree.** Against the Phase 2 AI over three seeds (±1.9%), with the gift weighed by the odds the dice deliver it (the successes for the move and no turnover, which would bench the friend): by the dice the command rolls, so a setter rolls two, 47.9%; by the dice `diceWorth` would pick, so a one-die setter goes first less often, 50.5%. The first is a loss and the second is noise, so the dice policy is right to give a setter one die: the turnover two dice risk costs more than the gift.

## Phase 3: one scale instead of a ladder

- Score the active unit's whole activation with the engine's `getActionPlans` (every move-then-strike it could make with the actions it holds): the plan's expected value plus the threat and exposure of the position it ends in. Play the plan's first command; plan again on the next call.
- Attack, Shoot, Move and Guard now compete on expected value. A unit can decline a losing attack to take a flank, or guard a chokepoint.
- Keep hard floors only where the rules need them (the Pig ending in the goal, a King never trading blows for nothing).

Tests: a unit facing a blow at bad odds, with a flank one move away, moves; a unit with a good blow still strikes.

Done when: ≥ 54% vs the Phase 2 AI in annihilation, others not below 46%.

Done: 54.9% ±1.9% in annihilation over three seeds, the other modes untouched. It was built in two steps, each benched over the same three seeds:

- **3a, plans for move-then-strike only: 51.8% ±1.9%.** A move followed by a strike was weighed against the best blow or shot from where the unit stood, and went first when it was worth more; a shooter's move counted the shot it led to. Everything else stayed on the ladder. It picked another command than Phase 2 in about 3% of a unit's decisions, nearly all of them a flyer, a Slippery unit or a shooter: anyone else pays a free hack to step round a foe.
- **3b, no ladder: 54.9% ±1.9%.** This is what is kept (`planScores`). It picks another command in about 17% of a unit's decisions. Most often it ends the activation where the ladder attacked at bad odds or stepped up into a risk; next it moves where the ladder attacked.

What was built differently from the list above:

- **The plans do not come from `getActionPlans`.** On `stone-crown` a call costs 1 ms with one action, 60 ms with two and 225 ms with three: it walks again from every hex of the first move and builds a path for each. So each legal Move is followed by the best strike its own hex allows with the actions then left, a blow at a foe beside it or a shot at one in range and in sight. That is every one-move-then-strike chain the engine would give, from every hex and not only the one it picks per target, at no walk beyond the one `getLegalCommands` has made. No change to the engine.
- **Two moves and then a strike are not planned.** With three actions the first move still closes on the foe by distance, and the plan is made on the next call. Reach for the other units is still the distance bound of Phase 1, in `threat` and in `activationOrder`.
- **The one scale** is a move's own: 1,000 points for a unit of `blowValue` (`PLAN_SCALE`, the same as `CHARGE_SCALE` and `SETUP_SCALE`), against ending the activation where the unit stands, which is 0. A blow or shot is worth its `blowValue` with the actions held. A move is worth the strike it leads to if that is worth making, plus `SETUP_SCALE × (Δthreat − EXPOSURE_WEIGHT × Δexposure)`, plus 100 a hex nearer the foe as before (`APPROACH`), less the free hacks, with the lava terms as they were. Only these values were tried.
- **Guard is worth what the riposte spares the unit**: what the enemy can expect to do to it as it stands, less the same with it on guard. Only a unit with the Guard trait can take the stance; anyone else with nothing worth doing ends its activation.
- **A shooter has no standoff ladder.** A hex nearer counts until the nearest foe is in range; from there its shots and its risks say where to stand. It still keeps out of contact and takes short range when it can, but with one action it now stops a hex outside the reach of foes it could not stand up to, where the ladder walked into range. A Magic User keeps the ladder: its spell is no part of threat.
- **Left as they were**: the choice of who activates, the dice, the war cry (a quorum still goes before anything; without one it now beats ending the activation), spells, lava and the cost of leaving contact, which at 30,000 still rules out stepping away from a standing foe. Weighing a free hack by its odds would let an ordinary unit give up a bad fight for a flank; not tried.
- **Tests.** Three scenes rested on the ladder and were changed: a Leader's blow at an equal after its war cry and a blow by a unit outnumbered two to one are no longer struck, so those foes are weaker or that unit stronger; the shooter test keeps its bounds against foes of Combat 3 and 4, and against Combat 5 holds the archer to its range with two actions and to one hex outside the foes' reach with one.
- **Stalled games.** 5 of the 2,574 games against Phase 2 reached the cap of 5,000 commands, and 2 of 858 against itself. All five against Phase 2 are a duel of the last two units, two hexes apart: the Phase 3 unit no longer has to close on a foe it expects to lose to, and that foe does not charge it either. `blowValue` counts a lost exchange for more than a lesser hit, so between near equals a fight can look like a loss to both. Phase 2 against itself had none in 858. A person facing it just attacks; a simulation that needs an ending should keep its step cap.
- **The stalls, fixed afterwards: with a side down to its last unit, nothing is held back.** Against the Phase 3 AI over three seeds: 49.5% ±1.9% with no game at the cap, and none in 858 against itself. Replaying the stalled games showed two causes, and only one was the uneven loss. The other is exposure: the unit to close stands where the foe gets the better blow (a Gryphon Rider and a Bone Captain each on ground the other would have to attack up to), so closing costs more than the 100 points a hex nearer is worth. What is kept (`lastStand` in `planScores`): when either side has one unit left, a lost exchange counts as the lesser hit it is (0.3 of own worth, not 0.4), and what a move or a guard does to the unit's own exposure is not weighed; the threat a move adds still is. The first attempt did this for a side's own last unit only: no stall against itself and 50.1% ±1.9%, but one game still at the cap, two wolves against a baseline Falcon perched in a corner with one hex beside it, which neither wolf would step into. So it applies to the side hunting a last unit too: no fall there exposes a friend to a second foe.

## Phase 4: the other modes

Zones, kings and flags override move scoring today, so Phases 1–3 only reach annihilation.

- Turn each mode plan into terms of the same evaluation: zone control and distance, King safety and King threat, flag carrier progress and interception.
- One mode per commit, each benched in its own mode. Capture-the-flag was scoped out of the last AI pass; ask before touching it.

Done when: each mode ≥ 54% vs the Phase 3 AI in that mode.

**King-of-the-hill, done: 56.9% ±1.9%** over three seeds against the Phase 3 AI (with its last-unit rule), every other mode at exactly 50.0%. On `stone-crown`: 4.22 / 13.5 / 40.4 ms, inside the budget of a 6.3 ms mean and no decision over 100 ms. The unit acting now goes through `planScores` as in annihilation, with the hill as terms of it:

- **Distance.** A unit `assignZones` sent to the hill counts its walking distance to the hill where an annihilation unit counts its distance to the nearest foe, at the same `APPROACH` a hex. A unit not sent hunts exactly as in annihilation, setup and exposure included (alone, that measured as noise in Phase 1).
- **Control.** The hill is ours, no one's or the enemy's by who has more standing units on it. A move that changes that is worth the step, and a step is a point a round. A point is worth its share of the game: `KING_WORTH` (30, what the game is worth where a King decides it) over the points to win (5), so 6 in `blowValue` terms. That was the first value tried and it cleared the bar, so no other was tried.
- **Blows count the hill too** (`hillSwing`), which the plan did not list: a blow or shot that may kill, knock down or push a foe standing on the hill is worth the step that would bring, by its odds; a blow struck from the hill costs the step the unit's own fall would lose, by the odds it loses. So a lone holder does not stake the hill on an even fight, a holder with a spare beside it fights as it would anywhere, and a foe on the hill is the one to strike. A push is taken to clear the hill, which a hill several hexes deep makes too generous.
- **One hard floor**: a unit standing on the hill it was sent to never moves off it, spare or not. Within the hill it moves as any unit does, for a blow or a flank.
- **Left as they were**: `assignZones`, the choice of who activates and with how many dice (still the ladder's: a unit in contact goes first even when it will only hold), and conquest. The last-unit rule of annihilation is off here: the points end the game.
- **Not weighed**: what the enemy could do to the hold on the hill by felling a holder. Exposure and the worth of a guard still count the unit's own worth only.
- **Tests.** One scene rested on the ladder: a lone holder no longer strikes an equal beside the hill, so the test of a blow from the hill is now Combat 5 against 2.
- **Tried, not kept: the two weaknesses above as terms of `planScores`.** Both show in a scene, and both scenes fail on the AI as it stands: a unit taking a two-hex hill alone takes the hex a Combat 2 foe can charge over the one it cannot (the foe's charge is a loss by its own worth, so exposure sees nothing, and the near hex adds a little threat); and a Combat 3 unit strikes a Combat 5 foe on the hill at one win in six when the hex behind the foe is hill too. Three variants against the AI with the Pig's clock, each over the same three seeds (±1.9%), none with a timeout and none reaching the 52% asked for, so `packages/ai` is as it was, scenes included, and both weaknesses remain:
  1. **Both: 50.2%.** *The push*: in `zoneSwing`, half of a lesser hit (and of a lost exchange, for the striker's own place) is a push, and it counts only when the hex behind is off the zone, or the unit is floored for want of room; a unit braced by a friend or Immovable stays. *The fall*: a unit on its feet in a zone held or level by one unit stakes a step on them. The chance the enemy fells it (each foe's blow by the odds it gets the actions, counted when the exchange and the step together are worth it to the foe, so a blow it would lose by counts too; a push as above) times the step was added to the risk of a move's hex, to what a guard spares, and, for the friends already in the zone, to what a spare stepping in takes off, all at `SETUP_SCALE × EXPOSURE_WEIGHT`.
  2. **The push only: 50.0%.** It changes about one decision in 250.
  3. **Variant 1, with the falls in a zone combined as the chance that any holder falls, not summed: 50.9%.** In variant 1 a unit stepping in to level the hill could count more than the one step lost. The best of the three; in conquest over the same seeds it measured 51.5% ±1.9%, no timeouts.

  Decision times on all maps were the baseline's in each (mean 3.9 ms against 3.9); `stone-crown` was not timed, as nothing was kept. The fall term picks another command in about 3% of decisions, two thirds of them another hex of a move, and most of the rest a holder that stays put where it used to shuffle within the hill. What it suggests: the hold is rarely lost by where a holder stands, since `assignZones` already sends two spares and a holder never leaves. Decided alone, as the run was unattended: the push was applied to the striker's own loss as well as to the foe's, and the third variant was spent on the sum rather than on a split of the fall term. Next to try: the mirror, the threat a move puts on an enemy holder whose fall would win the step, and the activation order, which is still the ladder's.

**Conquest, done: 59.2% ±1.9%** over three seeds against the AI with the hill on the one scale, no timeouts, every other mode at exactly 50.0%. On `stone-crown`: 5.28 / 11.3 / 43.3 ms, inside the budget of a 10.6 ms mean and no decision over 100 ms. The hill's terms were generalised to any number of zones rather than copied (`HoldView`, `zoneControl`, `zoneSwing` in place of `HillView`, `hillControl`, `hillSwing`), so the hill is the one-zone case of the same code:

- **Distance.** A unit counts its walking distance to the zone `assignZones` sent it to, at `APPROACH` a hex. A unit not sent hunts as in annihilation.
- **Control.** Each zone is ours, no one's or the enemy's by its standing units, and a move is worth the steps it changes summed over the three zones: the one it enters and the one it leaves. A step is `KING_WORTH` over the points to win (8), so 3.75. That was the first value tried and it cleared the bar, so the two others allowed were not tried.
- **Blows** count the step they may win in the zone the target stands in and the step they may lose in the zone the attacker stands in, by the same odds as on the hill.
- **One hard floor**: a unit standing in the zone it was sent to does not walk out of it. A unit standing in a zone it was not sent to (the zone is full) may leave, and the step that costs is weighed.
- **Gone**: `zoneMoveScore` and the ladder's zone branches for a move and a guard, which no mode reaches any more. The ladder still chooses who activates and with how many dice, in every zone mode.
- **Left as they were**: `assignZones`, the activation order, the dice. Not weighed, as on the hill: what the enemy could do to a hold by felling a holder.
- **Tests.** No scene rested on the ladder: the two conquest scenes there were pass unchanged, and three were added (a lone holder at bad odds, the flanking hex of a zone, a holder that stays).

**Kill-the-king, done: 59.7% ±1.9%** over three seeds against the AI with conquest on the one scale, no timeouts, every other mode at exactly 50.0%. On `stone-crown`: 4.07 / 13.5 / 37.5 ms, inside the budget of a 6.3 ms mean and no decision over 100 ms. The unit acting goes through `planScores` as in annihilation, and the mode is on the scale mostly by what a King is worth (`worthOf`, `KING_WORTH`), with no new constant:

- **Distance.** A unit counts its distance to the enemy King (`kingHuntDistance`, walking unless it flies) where an annihilation unit counts the nearest foe, at `APPROACH` a hex; a shooter counts it no nearer than its range. Our King counts none.
- **The enemy King** is worth the game to a blow, a shot and the threat of a move, through `worthOf`: nothing was added for it.
- **Our King's safety is exposure at `KING_WORTH`**, again through `worthOf`: what the enemy can do to it is in the exposure of every move (its own most of all, so it moves to where it has less to fear, and otherwise stays) and in the worth of its guard. For blows it is a term of its own (`kingSwing`, beside `zoneSwing` in `strikeValue`): a blow or shot at a foe is also worth what that foe's own blow adds to the King's exposure (`threatShares` in `tactics.ts`), by the odds it kills, knocks down or pushes it. As with a zone, the lesser hit is taken to clear the foe away.
- **Two hard floors.** Our King never strikes a foe on its feet other than the enemy King (`tradesForNothing`), whatever the odds. And a blow at the enemy King counts nothing for what the striker may lose by it, unless the striker is our King: see the stalls below.
- **Gone**: the King's safety ladder (`kingSafety`) and the ladder's branch for our King's blows. `kingMoveScore`, `kingTargetBonus` and the ladder's other King branches now serve the golden Pig only. The ladder still chooses who activates and with how many dice (`kingActivationScore`, which still orders hunters by the threats to our King).
- **Left as they were**: `kingPlan`, the activation order, the dice, the Pig. A King left on its own still hunts like anyone, and the last-unit rule of annihilation holds here too, except for our King while it has a warband.

Three variants were benched, each over the same three seeds (±1.9%):

1. **Quarry by `kingHuntDistance` as it was (threats to our King first), no `kingSwing`, no floor for a blow at the enemy King: 61.3%, 1 timeout.** The game at the cap: two flyers sent to a Big, Tough foe two hexes from their King, which could not reach it over the rock; neither would strike it at those odds, and with it as their quarry neither went for the enemy King.
2. **Quarry always the enemy King, protection by `kingSwing`: 60.6%, 2 timeouts.** Both at the cap were an Armored King on high ground that the units left could knock down about one time in twelve and never kill outright: the blow is a loss by the units' own worth, so they stood off, and the baseline's side could not reach ours either.
3. **Variant 2, and a blow at the enemy King costs the striker nothing: 59.7%, no timeouts.** Kept: the only one with no game at the cap. The three are within the margin of each other on win rate.

What differs from the plan:

- **The quarry is not `kingHuntDistance` as it stood**: the threats to our King are left out of the distance (variant 1's stall). They are weighed in blows instead. A move toward a threat counts only what the engine's odds say it does for the King: outnumbering the foe beside it, or taking the hex it would charge from.
- **The floor for a blow at the enemy King** is not on the plan's list. Without it a game can end with neither side able to make itself attack.
- **A Magic User** keeps its standoff from the nearest foe, as in annihilation; on the ladder it walked up to its quarry here.
- **High ground** is no longer a term of a hunter's move (the ladder gave it 30 points a level): it counts where the odds see it.
- **Not weighed**: what a unit does for its King by standing near it with no foe in reach, and what a knocked-down foe can still do to the King.
- **Known weakness, not fixed (the three variants were spent):** our King's safety is only what the foes in reach can do to it now. Among hexes out of every foe's reach it takes the first legal one, which can be a corner of the map, where the ladder kept it off the edge; and with a foe in reach wherever it goes, it may step toward the enemy King for the threat. A tie-break by distance from the edge is the first thing to try next.
- **Tests.** Five scenes rested on the ladder. In `tactics.test.ts`, the King two hexes from a raider no longer has to end further from it (nowhere it can go is out of its reach); it still must not end on the edge of the map. In `kings.test.ts`: the King beside a standing foe no longer steps away at the cost of a free hack: it holds or guards. a unit no longer turns back toward a threat it cannot reach this activation: it strikes the foe beside its King over a like foe elsewhere. high ground among equally near hexes is dropped; the scene of a blow at the enemy King over a downed foe passes unchanged, but only with the floor. Added: our King steps out of a foe's charge reach, a blow at the enemy King at odds refused against anyone else, the hex that flanks the enemy King.
- **Tried, not kept: the two weaknesses above as terms of `planScores`.** Both show in a scene (the King fleeing a foe six hexes off ends four hexes from a guard it could have stood beside; a Combat 4 King in a Fast raider's reach wherever it goes steps into a second foe's reach to threaten a Combat 1 enemy King). Three variants against the AI with capture-the-flag on the one scale, each over the same three seeds (±1.9%), none reaching the 52% asked for, so `packages/ai` is as it was and both weaknesses remain:
  1. **Our King counts its hexes to the nearest friend at `APPROACH`, and its moves weigh exposure only, not the threat they add: 50.1%, no timeouts.** Both scenes pass.
  2. **Variant 1, but the hexes to a friend count only while a foe has a blow on the King where it stands: 47.9%, 1 timeout.** So a King that trails its warband when nothing threatens it does better than one left where it started.
  3. **The hexes to the nearest friend only, the King's threat weighed as before: 51.0%, no timeouts.** The first weakness alone; the second scene still fails.

  Decision times on all maps were the baseline's in each (mean 3.8 to 3.9 ms); `stone-crown` was not timed, as nothing was kept. What it suggests, all within the margin: staying by the guard is worth a point or two, and taking the King's threat away costs about one, perhaps because a King that never closes for a blow next round leaves an endgame against a weak or downed enemy King to its last friend. Two older scenes broke under every variant and say what the distance term costs at `APPROACH`: a King with one action beside a downed foe walks back to a far guard instead of finishing it, and a King in reach wherever it goes takes an edge hex beside a guard that stands on the edge (the odds call that hex no worse). Decided alone, as the run was unattended: variant 3 dropped the second fix rather than the first, on the word of variants 1 and 2. Next to try: the weaknesses outside these two, such as a King held beside a standing foe by `DISENGAGE_COST`, or reach beyond one Move and a strike.

**The golden Pig, done: 62.9% ±1.9%** over three seeds against the AI with kill-the-king on the one scale, no timeouts, every other mode at exactly 50.0%. On `stone-crown`: 4.13 / 11.3 / 25.3 ms, inside the budget of a 7.3 ms mean and no decision over 100 ms. The unit acting goes through `planScores` as in kill-the-king (`Court`, `kingSwing`, `placeScore`, generalised rather than copied), and the Pig is on the scale by what it is worth (`worthOf`, `KING_WORTH`), with no new constant:

- **Distance.** The Pig counts its walking distance to the goal at `APPROACH` a hex. An escort counts `kingHuntDistance`, which with no enemy King is the distance to the foe nearest the Pig; a hunter counts it to the Pig, half a hex more from behind it.
- **The Pig to its hunters** is worth the game to a blow, a shot and the threat of a move, through `worthOf`: nothing was added.
- **The Pig's safety is exposure at `KING_WORTH`** for its escort, through `worthOf`: in every move of an escort and of the Pig itself (which stops short of where a foe could charge it), and, for an escort's blow, in what the foe struck adds to the Pig's exposure (`kingSwing`).
- **Two hard floors**, as planned: the Pig standing in the goal ends its activation there, and a move that takes it into the goal comes before anything else. "A move it can finish" was read as any move that ends on a goal hex, a free hack on the way or not: nothing it could do instead is better.
- **The Pig's own blows are weighed**, where our King's are barred (`tradesForNothing`): what it is worth is in what a lost exchange costs it, so it holds beside an equal and strikes a foe that is down or far weaker. And a blow at the Pig is not free to its striker, as a blow at the enemy King is: the clock ends this game, so no stall needs breaking.
- **Gone**: `pigMoveScore`, `kingMoveScore`, `kingTargetBonus` and the ladder's Pig branches for a blow, a shot, a move, a guard and ending the activation. The ladder still chooses who activates and with how many dice (`kingActivationScore`, `pigCanGetHome`): the Pig still goes ahead of every escort that is not fighting, and first of all on three dice when one roll can take it home.
- **Left as they were**: `kingPlan`, the activation order, the dice. The last-unit rule of annihilation holds for escorts and hunters, as in kill-the-king.

Three variants were benched, each over the same three seeds (±1.9%):

1. **The plan as written: 57.0%, no timeouts.** All of the gain is as escort. A split by role over a fifth of seed 1 (86 games a role): its escort won 44% against the baseline's defenders where the baseline's own won 29%, and as defender it held the baseline's escort to 28%, no better than the baseline did. The baseline's Pig runs at the goal and is cut down in two games out of three; this one stays out of reach, so its games last five rounds, not three, and one in eight is lost on the clock.
2. **Variant 1, and the Pig does not lead its escort: 61.1%, no timeouts.** The Pig counts no hex nearer the goal than the nearest of its escort has come (`escortFront`). In variant 1 the Pig, which activates before its escort, walked two Moves ahead of it in the first round to just outside the foes' charge reach, and was caught there by foes with three actions or wings: it died with two foes beside it and no friend within two hexes. Fewer than half as many Pigs fall, and more games go to the clock.
3. **Variant 2, and a Pig out of time holds nothing back: 62.9%, no timeouts.** Kept. When the rounds still to play are no more than the Moves the Pig is from the goal, at the Move a round its clock is set by (`pigOutOfTime`), it no longer waits for its escort and no longer weighs what it is exposed to, as with a side down to its last unit.

What differs from the plan:

- **The Pig does not lead its escort**, and **the clock**: neither is on the plan's list. Both are terms of the Pig's distance, at `APPROACH`, with no constant of their own; the clock rule uses the one Move a round the round limit is built on (`defaultPigRounds`).
- **The escort's quarry is `kingHuntDistance` with the threats left out**, as kill-the-king kept it: the foe nearest the Pig, by plain distance. A foe that threatens the Pig is weighed in blows and in exposure instead.
- **High ground** and a shooter's line of sight to the Pig are no longer terms of a move: they count where the odds see them.
- **Decided alone, as the run was unattended:** the role split and a few screens were run on parts of seed 1 (143 games, about ±4%, escort wins against the baseline's defenders) to choose what went into variants 2 and 3. They are not benches and none was kept on their word alone. Screened and dropped: a hex of the Pig's way worth its share of the game in place of `APPROACH` (`KING_WORTH` over the round limit: 42% against 44% for variant 1; over the rounds to spare: 38%), a free hack weighed by its odds so the Pig can leave a foe (43%), the clock rule without the escort rule (no gain), a round of margin on the clock (within noise). For the defender: a blow at the Pig free to its striker, and hunters that hold nothing back (the baseline's escort won 31% and 33% against them, 32% against variant 1's).
- **Not weighed**: what an escort does for the Pig by standing near it with no foe in reach, and reach is still one Move and a strike, so a foe with three actions is not seen coming.
- **Known weaknesses, not fixed (the three variants were spent):** as defender the AI is no better than the ladder was. The Pig beside a standing foe neither strikes it (the exchange is a loss at what the Pig is worth) nor leaves (the free hack still costs 30,000), so one foe can pin it for rounds while the clock runs; with variant 3 about one game in ten as escort is still lost on the clock. Weighing the rounds left as a share of the game is the next thing to try, with the activation order: the Pig going after its escort rather than before.
- **Tests.** One scene in `pig.test.ts` rested on the ladder: the Pig walking toward the goal now has its escort ahead of it, not behind. The other six pass unchanged. Added: the Pig does not walk ahead of its escort; it stops short of where a foe could charge it; with no round to spare it goes on, ahead of its escort and into reach; it holds beside an equal foe and strikes a weak one; an escort strikes the foe beside the Pig at odds it refuses elsewhere.
- **The three weaknesses above, taken up afterwards as terms of `planScores`: 53.1% ±1.9%** over three seeds against the AI with capture-the-flag on the one scale, no timeouts, every other mode at exactly 50.0% (capture-the-flag with 2 games of 858 at the step cap, one matchup in both seat orders: the two AIs are the same there, so that stall was in the baseline already). On `stone-crown`, two runs: 4.93 / 16.0 / 36.9 and 4.78 / 16.0 / 35.9 ms (the baseline in the same runs: 4.68 / 13.5 / 36.8 and 4.59 / 13.5 / 44.0), inside the budget of a 7.3 ms mean and no decision over 100 ms. No new constant: the round limit is on the scale as the share of the game it takes, at `KING_WORTH`.
  - **The clock** (`clockCost`). With so many Moves still to make and so many rounds to make them in, the Pig loses the game to the clock when its dice give it a Move in too few of those rounds: the engine's own odds on two dice, at a Move a round, the pace `pigOutOfTime` and the round limit already count by. A Pig behind that pace counts a whole game for each round it is behind, so a Move is always worth making. A Move of the Pig's is worth what it wins back of that share, and the term is not held to `escortFront`: with rounds in hand it is nothing and the Pig waits as before, with one round in hand it is a few thousand points against what the Move exposes it to, and behind the pace it is the game.
  - **The free hack by its odds.** The Pig weighs the hacks it draws by leaving a foe (`hackRisk`, as a flag carrier does) where it was held by `DISENGAGE_COST`. With rounds in hand it still holds beside an equal foe: the hack costs more than the hexes. Once the clock is against it, it goes.
  - **The Pig's road, for its hunters** (`PigRoad`). How much of its next Move the Pig loses to the hunters in its way, by the engine's own walk: it passes no foe and stops where it comes beside one, and a hex beside a standing foe is no progress, since leaving it costs a hack. So a standing hunter beside the Pig takes the whole Move, and one across its road the hexes it can no longer make. A hunter's move is worth what that adds to the clock's share, and a blow struck from such a hex costs the same by the odds it is lost, since a hunter down or driven off bars nothing. The road is only looked at once a lost Move is worth a point on the clock, so in the first rounds the hunters play as before.
  - **Two variants were benched**, each over the same three seeds (±1.9%), neither with a timeout: 1. the clock and the hack, for the Pig only: **52.6%**. 2. Variant 1 and the hunters' road: **53.1%**, kept. The third was not spent: nothing screened below was worth a bench.
  - **Which faults are fixed.** *Pinned for rounds*: fixed for the case the note named, in part. The Pig leaves a foe once the clock is against it; it still never strikes an equal foe to get free, and that is right by the numbers (leaving at once keeps every action for a Move unless the hack lands, and only the Pig can be hurt by it; striking first spends an action on an exchange it loses as often as it wins). About half the games still lost on the clock end with the Pig beside a standing foe (8 of 15 on a third of seed 2), most of them two or three Moves from the goal. *Lost on the clock*: fewer, not gone (see the screens). *The defender*: better when the clock is short, by the screens; on the bench the hunters' term adds 0.5%, inside the margin.
  - **Decided alone, as the run was unattended:** the model of the clock (a Move a round, not the two actions a good roll gives: the Pig spends those on standing up and on waiting, and the round limit is built on the one). And screens by role on a third of seed 1 (143 games a role, about ±8%; escort wins), which are not benches. The baseline against itself: 39.9%, with 26 games in 143 called by the clock, so nearer one in five than the one in ten the note gave. Variant 1 as escort: 43.4%, 18 on the clock, 47 Pigs home against 29. Variant 2 as defender: the baseline's escort held to 36.4%, 34 on the clock against 26. Screened as escort against variant 1's 43.4% and dropped: an escort's blow at a hunter in the Pig's way counting the road it clears (42.0%); a hex beside a standing foe counting a Move more of the Pig's own road, so it avoids such hexes and leaves them sooner (36.4%, with ten more Pigs killed); half the lesser hits of a free hack left out, since a recoil lets the leaver go (42.0%); the Pig out of time still weighing what it is exposed to (42.7%).
  - **Still known.** In nearly half its escort games the Pig is killed, clock or no clock: reach is still one Move and a strike. The Pig still activates ahead of its escort. The hunters' road looks one Move of the Pig's ahead, and counts a hunter that wins its blow as still in the way.
  - **Tests.** One scene changed: the Pig that waits for its escort "with a round in hand" now has rounds in hand (a limit of 12), since with one it goes. Added: the Pig with one round in hand goes on ahead of its escort; beside a standing foe it pays the hack once the clock is against it, and holds with rounds to spare; a hunter that cannot reach the Pig stands across its road, one beside a Pig with no round to spare holds rather than strikes, and with rounds in hand it strikes.

**Capture-the-flag, done: 64.1% ±1.9%** over three seeds against the AI with the golden Pig on the one scale, no timeouts, every other mode at exactly 50.0%. On `stone-crown`: 4.54 / 13.5 / 41.6 ms, inside the budget of a 55.5 ms mean and no decision over 100 ms (the owner gave the say-so this mode needed). The unit acting goes through `planScores` as in the golden Pig (`Court`, `kingSwing`, `placeScore`, the Pig's floor for its goal, generalised rather than copied), and the mode is on the scale by what a capture is worth, with no new constant:

- **A capture is worth the game.** A point is `KING_WORTH` over the points to win (`pointWorth`, which the zone modes now share). The engine sets no target score here and ends the game on the first capture (`captureIfHome`), so a capture is `KING_WORTH`, 30.
- **A unit with a flag in its hands is worth the capture** to both sides (`worthOf`). From that alone: a blow or shot at the enemy carrier and a hex that threatens it count the capture; a blow our carrier strikes counts the capture a lost exchange may cost; and what the enemy can do to it is in the exposure of its own moves and of its friends', in the worth of its guard, and in a friend's blow at a foe that threatens it (`kingSwing`).
- **Distance.** The carrier counts its walking distance home; everyone else the nearest of the enemy flag, our own where it lies dropped and the enemy carrier (`flagDistance`), at `APPROACH` a hex; with none of those, the nearest foe as in annihilation.
- **One hard floor**, as planned: a carrier that can step onto its base does.
- **Gone**: `scoreFlagCommand`'s scoring of a blow, a shot, a move and a guard, and with it the ladder's last helpers for those (`pressedEdge`, `meleeEdge`, `shotPenalty`). What is left of it is `flagActivationScore`: who activates and with how many dice, as before.
- **Left as they were**: `flagPlan`, the activation order, the dice, and magic, which still counts a carrier at its own worth (`ownWorth`) for whether to cast and at whom, since that is part of who activates. The last-unit rule of annihilation holds here.

Three variants were benched, each over the same three seeds (±1.9%), none with a timeout:

1. **The terms above, a carrier's free hacks by their odds, a lesser hit on the enemy carrier at the usual 0.3 of its worth: 63.9%.**
2. **Variant 1, but the carrier held in contact by `DISENGAGE_COST` like anyone: 62.4%.**
3. **Variant 1, and a blow that knocks down or pushes the enemy carrier counts the whole capture, as does a kill it would save against by being Tough (`stopsCapture`): 64.1%.** Kept, as the best and as what the plan asked ("the capture it may stop by its odds"). The three are within the margin of each other.

What differs from the plan:

- **Picking the enemy flag up, and sending our own home, are worth the capture too**, as a term of the move. With distance alone the last hex onto a flag was worth 100 points, and a unit one hex from its own dropped flag walked past it toward a foe. It is the same worth the flag has in a carrier's hands, not a new one, and not a floor: a unit beside a standing foe still weighs the free hack against it.
- **A carrier's free hacks are weighed by their odds** (`hackRisk`), at what it is worth, where anyone else is still held by `DISENGAGE_COST`. They are blows it risks, and the ladder let a carrier break away too. Alone it measured as noise (variant 2).
- **A shooter counts the enemy carrier no nearer than its range**, as it does the enemy King.
- **The distance fields are cached per map and hex** (`zoneField`), which `flagPlan` worked out afresh at every call: the mean on `stone-crown` fell from 19.9 ms to 4.5. The choice is the same.
- **Decided alone, as the run was unattended:** the first timing run on `stone-crown` showed a 139 ms decision, with 193 ms for the baseline in the same run. Three later runs gave maxima of 34.8, 41.6 and 36.2 ms (baseline 40.9, 54.7, 42.3), so the first was taken for the machine and not the AI.
- **Not weighed**: that a knocked-down carrier takes the flag back for free when it stands; what a unit does by standing between the enemy and our flag (no one is sent to guard it, as before); and reach is still one Move and a strike.
- **Tests.** No scene rested on the ladder: the eight there were pass unchanged. Added: a blow at the enemy carrier at odds refused against anyone else, a carrier that leaves a foe an ordinary unit is held by, and a carrier that does not end its move beside an equal foe on its way home.

Next: Phase 5, or the weaknesses still noted under kill-the-king and the golden Pig.

## Phase 5 (optional): lookahead

Only once the evaluator is good, and only if the budget allows.

- Beam search over the rest of the turn (which unit next, which plan), or rollouts of the top few candidates with the Phase 4 AI as the playout policy.
- Chance nodes use the odds, or a fixed seed derived from the state, never the game's RNG.
- Gives difficulty levels for free: depth and beam width.

## Later: tuning

With the bench in place, pull the constants into one `AiParams` object and let a self-play optimizer (SPSA or CMA-ES) set them: `pnpm play tune`. Re-run it after a rule change. Weaker parameter sets double as easier difficulty levels.

## Results

Win rate against the AI of the phase before, from `pnpm play bench --baseline …` at one seed (858 games per mode, ±3.3%). The last column is the decision time in annihilation on `stone-crown`, in ms: mean / p95 / max.

| Phase | Annihilation | King | Hill | Conquest | Flags | Pig | ms (stone-crown) |
|---|---|---|---|---|---|---|---|
| Baseline | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | 1.19 / 3.36 / 9.77 |
| 1: setup value for moves | **61.9%** | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | 3.03 / 9.51 / 39.5 |
| 2: activation order | 52.2% (three seeds, ±1.9%) | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | 3.29 / 11.3 / 33.2 |
| 3: one scale instead of a ladder | **54.9%** (three seeds, ±1.9%) | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | 3.12 / 9.51 / 26.7 |
| 3, last-unit rule (no stalls) | 49.5% (three seeds, ±1.9%) | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | not measured |
| 4: the hill on the one scale | 50.0% | 50.0% | **56.9%** (three seeds, ±1.9%) | 50.0% | 50.0% | 50.0% | hill: 4.22 / 13.5 / 40.4 |
| 4: conquest on the one scale | 50.0% | 50.0% | 50.0% | **59.2%** (three seeds, ±1.9%) | 50.0% | 50.0% | conquest: 5.28 / 11.3 / 43.3 |
| 4: kill-the-king on the one scale | 50.0% | **59.7%** (three seeds, ±1.9%) | 50.0% | 50.0% | 50.0% | 50.0% | king: 4.07 / 13.5 / 37.5 |
| 4: the golden Pig on the one scale | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | **62.9%** (three seeds, ±1.9%) | pig: 4.13 / 11.3 / 25.3 |
| 4: capture-the-flag on the one scale | 50.0% | 50.0% | 50.0% | 50.0% | **64.1%** (three seeds, ±1.9%) | 50.0% | flags: 4.54 / 13.5 / 41.6 |
| 4: the Pig's clock, and its road for the hunters | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | **53.1%** (three seeds, ±1.9%) | pig: 4.93 / 16.0 / 36.9 |

The budget that follows from the baseline: a mean of at most 3.6 ms and no decision over 100 ms, in annihilation on `stone-crown`.

Phase 1 across all eleven maps, ten games at a time on a twelve-thread machine (so slower than a game alone): 3.39 / 11.3 / 76.7 ms in annihilation, against 1.16 / 3.36 / 30.7 for the baseline in the same run.

Baseline decision times in the other modes on `stone-crown` (mean / p95 / max, ms): King 2.11 / 4.00 / 18.7, Hill 2.10 / 4.76 / 14.5, Conquest 3.52 / 5.66 / 25.6, Flags 18.5 / 38.1 / 46.7, Pig 2.42 / 4.76 / 17.7. Across all eleven maps the annihilation mean is 1.18 ms.
