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

The budget that follows from the baseline: a mean of at most 3.6 ms and no decision over 100 ms, in annihilation on `stone-crown`.

Phase 1 across all eleven maps, ten games at a time on a twelve-thread machine (so slower than a game alone): 3.39 / 11.3 / 76.7 ms in annihilation, against 1.16 / 3.36 / 30.7 for the baseline in the same run.

Baseline decision times in the other modes on `stone-crown` (mean / p95 / max, ms): King 2.11 / 4.00 / 18.7, Hill 2.10 / 4.76 / 14.5, Conquest 3.52 / 5.66 / 25.6, Flags 18.5 / 38.1 / 46.7, Pig 2.42 / 4.76 / 17.7. Across all eleven maps the annihilation mean is 1.18 ms.
