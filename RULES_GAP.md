# Rules gap: the original game vs. FanSong

This lists the rules of the original *Song of Blades and Heroes* (core rules plus
the revised and advanced editions) that FanSong does **not** implement yet,
compared against the engine as of commit `15b3624`. Items since implemented
(M8 in [PLAN.md](PLAN.md)) are marked **✅ Done** with the choices made.

The rules below are described in our own words, following the IP note in
[PLAN.md](PLAN.md). If any of them get implemented, the engine should keep its
own numbers and wording.

**Confidence.** The core rules (activation, combat results, fallen models, free
hacks, outnumbering, morale dice, range bands) are corroborated by several
sources. Items marked *(verify)* come from a single source or from the revised
and advanced editions, and their exact numbers should be checked against a
rulebook before they are built.

---

## 0. What already matches

These are implemented, so they are not listed again below:

- Activation with 1 to 3 dice against Quality, where each success is one action
  and 2 or more failures cause a turnover.
- An opposed d6 + Combat roll. A tie does nothing, doubling the loser kills it,
  and a plain win makes the loser **recoil** on the winner's odd die or **fall**
  on an even one. A loser with nowhere to recoil falls instead.
- Beating a fallen model kills it, standing up costs one action, and a fallen
  carrier drops its objective.
- Shooting cannot be done while the shooter is in melee, needs line of sight,
  and the shooter takes no damage back.
- Tough, so the first killing blow becomes a fall.
- A **power blow** or **aimed shot**: spend both actions of a two-action
  activation on one attack or shot, and its target defends at −1 (§3.5, §4.6).
- **(M8)** Moving into contact stops a walk, leaving contact draws free hacks,
  outnumbering gives −1 per extra standing foe, tripling the loser is a
  gruesome kill (the only kind that causes fear), and shots take −1 beyond
  short range and −1 against cover. Details in §2–§5.
- High ground gives +1.
- Woods block line of sight *through* them, and impassable terrain exists.
- Deployment zones, and objective modes that work like scenarios.

## 1. Deliberate divergences (not gaps, but worth knowing)

| Original | FanSong | Note |
|---|---|---|
| A player activates models one after another until a turnover or until they choose to stop, and then the whole turn passes to the opponent. | Players alternate **one unit at a time**, and a turnover benches the player for the round. | This is the project's core twist. |
| On a turnover the model **still takes the actions its successes earned**, and the turn passes afterwards. | The activation ends immediately and any successes are lost. | Decided in PLAN §5. It could become a config flag for an "original" mode. |
| Whoever goes first is decided by a roll, and players then alternate turns. | Initiative flips each round. | Part of the twist. |
| An attack against a fallen model gets **+2**, and any win kills it. | A fallen defender only hurts its attacker on a natural 6, and any win against it kills. | This is a different mechanism with a similar feel. The original's +2 also makes a double, and so a kill, much easier. |
| Points use a *multiplicative* formula: Combat and trait costs, scaled by a Quality multiplier. | Points use an original *additive* formula. | Intentional (IP note). Nothing to copy. |
| Fear: a **gruesome** kill (see §3) makes nearby friends test, and a failure means fleeing. | A gruesome kill makes friends within 4 hexes test with one die, and a failure means a knockdown. | The trigger now matches (M8); the 3-dice test and fleeing are still open (§5). |
| The player whose model is leaving contact chooses the order of the free hacks. | Free hacks come in unit order. | Avoids a new command mid-move; could become a choice later. |
| Range penalties are counted in measuring-stick bands. | One −1 band beyond short range (the first half of the reach, rounded up). | Our ranges are 3–4 hexes, so a second band would make long shots nearly useless. |

---

## 2. Movement and contact

1. ✅ **Done — moving into contact stops movement.** A model moving next to an
   enemy must stop there. *Implemented:* a walk may enter a hex next to any
   living enemy but not continue from it, and never crosses an enemy's hex
   (`walkRules` / `moveReach` in the engine's `query.ts`).
2. ✅ **Done — free hack when leaving contact.** *Implemented:* any move by a
   unit in contact draws a hack from each **standing** enemy touching it, in
   unit order. A double kills (Tough applies), an even-die win knocks the leaver
   down and stops the move, and an odd-die "recoil" lets it slip away.
   *Original:* When a model moves away from enemies it
   is touching, each of those enemies gets a free attack on it with no risk to
   the attacker (only results that hurt the model moving away apply). The
   player moving away chooses the order. If an early hack removes the model,
   the rest are lost.
3. **Move length categories.** The original has Short, Medium and Long moves
   rather than a free number. FanSong's integer `move` already covers this. The
   useful part is the **terrain step-down** in item 4.
4. **Difficult terrain.** Rough ground, woods, marsh and shallow water lower a
   model's move by one category (for example Medium becomes Short). A model can
   always move at least one base width *(revised)*. FanSong has no terrain that
   slows movement. Woods only block sight.
5. **Linear obstacles** such as walls and hedges. Crossing one costs extra
   actions or needs a Quality roll *(verify)*.
6. **Jumping, climbing and falling from heights.** These use Quality rolls, and
   falling can take a model out of action. Our elevation is currently free to
   climb.
7. **Free move** *(revised)*. A model far from every enemy (more than 2 Long)
   can move once without rolling to activate, so rear models don't get stuck.
8. **Follow-up** *(revised, optional)*. The winner may step forward into the
   hex a recoiling loser has left, keeping contact.

## 3. Melee combat

1. ✅ **Done — gruesome kill.** *Implemented:* flagged `gruesome` on the combat
   event; only these trigger fear (§5.1). *Original:* Beating the loser's score **three times over** is a
   gruesome kill. It removes the model *and* triggers morale tests (§5).
2. ✅ **Done — outnumbering.** *Implemented:* for attacks, guard ripostes and
   free hacks; knocked-down foes don't count. Scores can now reach 0 or below,
   so a kill needs a strict win and a double. *Original:* A combatant gets **−1 for each enemy in contact beyond the
   first**. This is the main way the original rewards ganging up.
3. **Target priority** *(revised, optional)*. A model touching several enemies
   must attack a standing one before a fallen one.
4. **Other combat modifiers** *(verify)*: +1 when mounted against models on
   foot, −1 when unarmed, and a penalty for fighting from water or difficult
   terrain. The size bonus is done — see **Big** in §7.
5. ✅ **Done — power blow.** *Implemented:* an attack may be declared as a
   **power blow**, costing 2 actions instead of 1, and the defender rolls at −1.
   It is a separate legal command (`Attack` with `power: true`), so a unit is
   only offered it with 2 actions in hand. The penalty is a defender-side
   modifier like outnumbering, so it can push a defence to 0 or below and make
   the kill threshold easier to reach. A guard's riposte happens *before* the
   blow lands and so is unaffected — but the 2 actions are spent even when the
   riposte repels the attack. *Original:* Spend 2 actions on one attack to give
   the target −1.
6. **Lethal attacks.** Beating a target that is asleep, transfixed, entangled or
   otherwise helpless kills it, just like beating a fallen model. This only
   matters once those conditions exist (§7).

## 4. Shooting

1. ✅ **Done (simplified) — range bands.** *Implemented:* −1 beyond short range,
   short range being the first half of the reach, rounded up. *Original:* A shot has no penalty within the first band, a penalty in
   the second band, a larger one in the third, and cannot reach beyond that
   *(the advanced edition uses −2 per band after the first; verify)*.
2. ✅ **Done — cover.** *Implemented:* −1 when the target stands in a forest, or
   when the sight line only just grazes past a blocker (terrain or a unit):
   the line with edge ties rounded the other way would be blocked. *Original:* A target that is partly hidden gives the shooter **−1**, and a
   target that is completely hidden cannot be shot.
3. **Shooting into or out of woods** *(revised)*. A model standing at the edge
   of a wood can shoot in and be shot, but a model deeper inside cannot shoot
   out or be targeted.
4. **No shots at targets in melee.** The *target* must not be in contact with
   an enemy either, unless it is fallen or transfixed. FanSong only checks the
   shooter.
5. **Must shoot the closest enemy**, unless that enemy is fallen, hidden,
   behind cover or much cheaper *(verify)*.
6. ✅ **Done — aimed shot.** *Implemented:* the ranged twin of the power blow
   (§3.5) — `Shoot` with `aimed: true`, 2 actions, and the target defends at −1.
   It stacks with the range and cover penalties on the shooter's own side, so a
   long shot into cover is still a long shot into cover. *Original:* Spend 2
   actions on one shot to give the target −1.
7. **Group shooting.** Shooters activated together with a Leader combine their
   fire (§6).

## 5. Morale

The original morale model is very different from FanSong's:

1. **Triggers:**
   - a **gruesome kill** (§3.1), tested by friends of the victim within **Long**
     range. ✅ *Done (M8):* friends within 4 hexes test;
   - **the Leader being killed**, tested by the whole warband;
   - the warband falling to **half or less** of its starting models, tested by
     the whole warband. FanSong uses a third, and tests only once;
   - fear-causing traits such as Terror (§7).
2. **The test:** roll **3 dice** against Quality.
   - With 0 failures the model holds.
   - With 1 or 2 failures the model **flees one full move away from the enemy
     for each failure**.
   - With 3 failures the model **routs** and is removed.
   - A fleeing model that leaves the table is lost.

   FanSong uses a single die, and a failure means a knockdown (from fear) or
   removal (from a rout).
3. **Fleeing models** turn away from the enemy, and moving away from contact
   provokes free hacks (§2.2). They can be caught and cut down.
4. **Optional** *(revised)*: a model that fails a morale test before it has
   activated this turn cannot activate this turn.

## 6. Leaders and group activation

None of this exists yet. The `kings` of kill-the-king only exist for that
objective and are not leaders.

1. **Leader trait.** A warband has at most one Leader.
2. **Group activation.** The Leader activates together with friends within Long
   range. One activation roll is made, using the Leader's Quality, and the group
   then spends its actions together on a **group move** or a **group attack**
   (friends in contact with the same enemy add to the attack) *(verify the
   exact mechanics)*.
3. **Group shooting.** Shooters in a group fire together.
4. **Leader death** makes the whole warband test morale (§5.1).
5. **Sub-commanders** for large warbands *(revised, optional)*.

## 7. Special rules (traits)

FanSong has 3 traits: Ranged, Tough and Guard. Guard has no direct equivalent in
the original. The original core rules have roughly 50 more. Each line below is a
short paraphrase, and the exact effects should be checked before building one.

**Movement:**
- **Long Move / Short Move / Slow:** change the move category. Our `move` stat
  already covers these.
- **Flying:** ignores terrain and can move over other models.
- **Forester:** moves normally through woods.
- **Amphibious:** moves normally through water.
- **Mountaineer:** moves normally over rough and uphill ground.
- **Acrobat:** better at jumping and climbing, and leaves combat more easily.
- **Free Disengage:** can leave contact without taking free hacks. This needs
  §2.2 first.
- **Dashing** *(revised)*: a movement bonus tied to activation.

**Melee:**
- **Combat Master:** enemies get no outnumbering bonus against it. This needs
  §3.2 first.
- **Hatred:** a bonus against one named enemy type.
- **Savage:** more lethal against some opponents.
- **Poison:** extra harm on some die results. It has no effect on undead.
- **Magic Weapon:** can hurt creatures that only magic can harm.
- **Assassin:** a bonus when attacking a model that is already engaged, or from
  surprise.
- ✅ **Done — Big.** *Implemented:* a `big` trait. A Big model scores +1 in
  every melee against a non-Big opponent — attacking, defending, riposting and
  hacking at a leaver alike — and two Big models cancel out. Unlike high ground
  the bonus survives a knockdown (`attackBig` / `defenseBig` / `guardBig` /
  `attackerBig` event fields). Anyone shooting a Big model gets +1 (`bigTarget`),
  a Big shooter included. *Original:* size bonuses in melee; they are easier to
  shoot, cannot hide, and more attackers fit around them.
- **Huge / Gargantuan:** the larger sizes, and the hiding and contact-capacity
  parts of size, are still open.
- **Mounted:** +1 against models on foot.
- **Rabble:** a cheap mob model that fights better next to friends of its own
  kind *(revised)*.
- **Swarm:** a mob that is hard to kill outright.
- **Entangle:** a target it beats cannot move away.
- **Distract:** makes enemies in contact worse.

**Shooting:**
- **Shooter (Short / Medium / Long):** our `ranged` stat already covers this.
- **Good Shot / Unerring Aim / Legendary Shot** *(revised)*: better aim, halved
  range penalties, and more shots per action. These need §4.1 first.

**Morale:**
- **Steadfast:** a bonus on morale tests.
- **Fearless:** immune to (or strongly resistant to) morale tests.
- **Heroic:** does not flee as easily, and inspires others.
- **Terror:** enemies must pass a test to attack it, or must test when it
  charges them.
- **Coward:** the opposite of Steadfast.
- **Undead:** immune to poison and to many morale effects, but vulnerable to
  Clerics.
- **Demon:** similar in kind to Undead.

**Behaviour:**
- **Gregarious:** worse when it is away from friends.
- **Lone:** cannot join group activations.
- **Greedy:** is distracted by loot and objectives.
- **Animal:** cannot carry objectives or use equipment.
- **Stealth:** hard to target at range.

**Magic** (§8): Sorcerer, Cleric, Necromancer, Elementalist, Shaman, Transfixer.

## 8. Magic

- **Spellcasters.** Casting a spell is an action, and ranged magic attacks are
  resolved with an opposed roll similar to shooting.
- **Transfix.** The target cannot act and is helpless (§3.6) until it breaks
  free.
- **Cleric:** heals, and is especially strong against Undead and Demons.
- **Necromancer:** raises the dead, can use fallen models, and is anti-life.
- **Elementalist:** blasts in an area.
- **Advanced edition only:** power points come from activation successes, a
  spell can backfire on 3 failures, spells can be resisted, and spells can be
  dispelled.

## 9. Warband building

- **Personalities.** Named heroes are capped at a fraction of the warband's
  points (about a third in the core rules and half in the advanced edition).
- **A standard game size** in points. FanSong validates points, but there is no
  agreed standard size yet.
- **Costing traits.** Every new trait needs a price in `packages/content`,
  following the existing pattern.

## 10. Scenarios and campaigns

- **More scenario types.** The original has a scenario generator. Missing kinds
  include treasure or loot hunts with several tokens, escort or
  assassinate-a-target missions, breakthrough (get models off the opposite
  edge), and defending a building. The last one needs door and wall rules.
- **Random terrain placement and deployment** from a scenario roll.
- **Campaign rules.** A persistent warband, injuries after a game (a model can
  die or keep a permanent injury), experience, advancement (better stats and new
  traits), and loot and upkeep between games.

---

## Suggested implementation order

These are the gaps that change play the most for the least effort, given how
the engine is built today:

1. ✅ **Stopping on contact and free hacks** (§2.1–2.2). Without them, melee has no
   "lock" and positioning matters much less. They also enable Free Disengage.
2. ✅ **Outnumbering** (§3.2). It is one modifier in the combat score, and it gives
   a reason to gang up.
3. ✅ **Gruesome kill, and fear only on a gruesome kill** (§3.1, §5.1). This brings
   morale closer to the original, and FanSong's current fear-on-every-kill can
   be tuned down.
4. ✅ **Range bands and cover** (§4.1–4.2). The board and line-of-sight code
   already have the pieces.
5. **Difficult terrain** (§2.4). The terrain map can take a new `feature` value.
6. **Leader and group activation** (§6). This is the biggest change to the
   activation twist, and it needs design work.
7. **3-dice morale with fleeing** (§5.2–5.3). It needs a flee-movement
   algorithm.
8. Traits in batches, then magic, then campaigns.

Every item needs a replay-version bump if it changes an outcome the golden
fixture covers. Items added as sparse, optional state (as M7 did) can leave the
default game byte-identical.

## Sources

- [Wikipedia: Song of Blades and Heroes](https://en.wikipedia.org/wiki/Song_of_Blades_and_Heroes)
- [Combat School for Song of Blades and Heroes (15mm Dungeon)](https://15mmdungeon.wordpress.com/2019/01/23/combat-school-for-song-of-blades-and-heroes/)
- [Revised Song of Blades & Heroes review (Wee Blokes)](https://weeblokes.blogspot.com/2012/09/revised-song-of-blades-heroes-review.html)
- [Advanced Song of Blades and Heroes review (Tabletop Stories)](https://tabletopstories.net/language/en/2019/08/advanced-song-of-blades-and-heroes-review-2/)
- [Maidstone Wargames Society, SBH posts](https://brigademodels.co.uk/mws/blog/category/rulesets/a-song-of-blades-and-heroes/)
- [BGG: Special Rules index](https://boardgamegeek.com/filepage/107597/special-rules-index)
