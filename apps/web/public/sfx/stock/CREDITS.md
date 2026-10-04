# Stock sound credits

The game's own sounds are recorded in the recording booth (`public/sfx/`).
Until a cue has a recording, it plays one of these stock clips instead, where
one fits (see `STOCK` in `src/audio/sfxCues.ts`). Every file here is
`<clip>-<n>.mp3`, one variant of a clip set. The files were converted to mono
MP3, trimmed of leading and trailing silence, and peak-normalised; nothing else
was changed, except where noted ("edited" below: shortened, layered with
another clip, slowed, filtered or faded).

They come from free projects, each taken from its Ubuntu 24.04 (noble)
package or npm, plus a few synthesised for this game. Their licences:

- **CC0 1.0** (public domain): no conditions.
- **CC BY 3.0 / 4.0**: free to use with credit, given below.
- **CC BY-SA 4.0**: as CC BY-SA 3.0 below, version 4.0:
  https://creativecommons.org/licenses/by-sa/4.0/
- **CC BY-SA 3.0**: free to use with credit; the sound files themselves (and
  any edits of them) stay under CC BY-SA 3.0. This does not extend to the rest
  of the game. The licence: https://creativecommons.org/licenses/by-sa/3.0/

## C-Dogs SDL (`cdogs-sdl-data`)

https://cxong.github.io/cdogs-sdl/ — each sound's original author and licence,
as listed in the package's `debian/copyright`:

| Files | Original | Author | Licence |
|---|---|---|---|
| `hit-0`…`hit-8` | hits/knife_flesh — https://freesound.org/people/lmbubec/sounds/118792/, https://freesound.org/people/MrPokephile/sounds/155973/ | lmbubec, MrPokephile | CC0 1.0 |
| `heavy-hit-1`…`heavy-hit-4` | hits/fist_flesh — https://freesound.org/people/CGEffex/sounds/98341/ | CGEffex | CC BY 4.0 |
| `armor-0`…`armor-4` | hits/knife_hard — https://freesound.org/people/geoffbarkman/sounds/53442/ | geoffbarkman | CC BY 4.0 |
| `death-0`…`death-4` | chars/die/man/3–7 — https://freesound.org/people/JohnsonBrandEditing/sounds/173944/ | JohnsonBrandEditing | CC0 1.0 |
| `grunt-0`, `grunt-1` | chars/alert/man/0 — https://freesound.org/people/davdud101/sounds/150505/; chars/alert/man/1 — https://freesound.org/people/Adam_N/sounds/166129/ | davdud101; Adam_N | CC0 1.0 |
| `war-cry-0`, `war-cry-1` | chars/alert/ogre — https://opengameart.org/content/15-monster-gruntpaindeath-sounds | Michel Baradari | CC BY 3.0 |
| `step-0`…`step-9` | footsteps/gravel — https://freesound.org/people/Ali_6868/packs/21608/ | Ali_6868 | CC0 1.0 |
| `gore-0` | splat — https://freesound.org/people/gprosser/sounds/360942/ | gprosser | CC0 1.0 |
| `flag-0` | pickup — https://freesound.org/people/daboy291/sounds/138078/ | daboy291 | CC0 1.0 |
| `victory-0` | victory — https://freesound.org/people/chripei/sounds/165491/ | chripei | CC BY 4.0 |
| `flap-0`…`flap-3` | hits/gas — https://opengameart.org/content/wind-hit-time-morph | Iwan "qubodup" Gabovitch | CC0 1.0 |
| `arrow-fly-0` | techdemo mission swoosh_echo — https://freesound.org/people/Electroviolence/sounds/234553/ | Electroviolence | CC0 1.0 |
| `snicker-0` | hahaha — https://freesound.org/people/teqstudios/sounds/118703/ | teqstudios | CC0 1.0 |
| `hm-0` | chars/alert/man/2 — https://freesound.org/people/Iceofdoom/sounds/411086/ | Iceofdoom | CC BY 4.0 |
| `panic-0` | chars/die/woman/2 — https://freesound.org/people/tcrocker68/sounds/235592/ | tcrocker68 | CC0 1.0 |
| `fall-0` | chars/die/woman/3 — https://freesound.org/people/pushkin/sounds/241591/ (edited: slowed, darkened, faded) | pushkin | CC0 1.0 |
| `scream-away-0` | chars/die/man/0 — https://freesound.org/people/creativeheroes/sounds/84353/ (edited: darkened, echoed, faded) | creativeheroes | CC BY 4.0 |
| `rattle-0`, `rattle-1`, `reassemble-0` | footsteps/bones — https://freesound.org/people/blukotek/sounds/249319/ (edited: several layered into a clatter) | blukotek | CC0 1.0 |
| `orc-1` | monster-2 — https://opengameart.org/content/monster-sound-effects-pack | Ogrebane | CC0 1.0 |
| `orc-death-1`, `orc-death-2` | chars/die/ogre/0, 2 — https://opengameart.org/content/15-monster-gruntpaindeath-sounds | Michel Baradari | CC BY 3.0 |
| `ghoul-death-0`, `ghoul-death-1` | chars/die/zombie/0, 3 — https://opengameart.org/content/zombies-sound-pack | artisticdude | CC0 1.0 |
| `beast-death-1` | chars/die/dog/0 — https://freesound.org/people/16G_Panska_Dolezal_Stepan/sounds/498703/ | 16G_Panska_Dolezal_Stepan | CC0 1.0 |
| `chitter-1`, `chitter-2`, `bug-death-1`, `bug-death-2` | chars/alert/alien/0–1, chars/die/alien/1–2 — https://opengameart.org/content/small-pest-aliencreature | Brandon Morris | CC0 1.0 |

## Lugaru (`lugaru-data`)

https://osslugaru.gitlab.io/ — sounds © 2003, 2010 Wolfire Games, CC BY-SA 3.0.

| Files | Original |
|---|---|
| `swing-0`…`swing-2` | LowWhoosh, MidWhoosh, HighWhoosh |
| `heavy-hit-0` | HeavyImpact |
| `clang-0`…`clang-3` | Clank1–Clank4 |
| `thud-0`…`thud-2` | Thud, Land1, Land2 |
| `skid-0`, `skid-1` | Skid, SnowSkid |
| `parry-0` | SwordStaff |
| `eep-0` | RabbitPain |
| `growl-0`…`growl-4` | Growl, Growl2 (both shortened), Snarl, Snarl2, BarkGrowl |
| `screech-0` | Hawk (shortened) |
| `pierce-0` | MoveWhoosh (slowed) layered with FleshStab |

## MegaGlest (`megaglest-data`)

https://megaglest.org/ — © 2001–2008 The Glest Team, 2008–2017 The MegaGlest
Team, CC BY-SA 3.0.

| Files | Original |
|---|---|
| `bow-0`…`bow-3` | techs/megapack/commondata/sounds/archer_attack1–4 |
| `arrow-hit-0`…`arrow-hit-4` | techs/megapack/commondata/sounds/arrow_hit1–5 |
| `screech-1` | tilesets/desert2/sounds/hawk (shortened) |
| `bird-death-1` | techs/megapack/factions/indian/units/thunderbird/sounds/eagle_die1 |

## uisfx (npm `uisfx` 0.4.0)

https://uisfx.com — by the uisfx project (© 2026 Yuki Capital), audio under CC0 1.0. The "organic" theme:

| Files | Original |
|---|---|
| `select-0` | select |
| `press-0` | press |
| `turnover-0` | error |
| `alarm-0` | warning |
| `score-0` | bonus |
| `capture-0` | achievement |
| `round-0` | notification |
| `guard-0` | toggle-on |
| `defeat-0` | stop |
| `ding-0` | check |
| `bonk-0` | uncheck |
| `tick-0` | release |
| `hover-0` | hover |
| `chime-0` | receive |

## Flare (`flare-game`)

https://flarerpg.org/ — © 2010–2021 Clint Bellanger and contributors; art and
sounds under CC BY-SA 3.0 unless the per-file credits
(https://github.com/flareteam/flare-game/wiki/Credits) say otherwise, as
below. Paths are under `mods/fantasycore/soundfx/`.

| Files | Original | Author | Licence |
|---|---|---|---|
| `heartbeat-0` | heartbeat (edited: the first beat of two) | the Flare project | CC BY-SA 3.0 |
| `ghost-0` | powers/teleport — https://opengameart.org/content/spell-sounds | Brandon Morris | CC BY 3.0 |
| `charge-0`, `dread-0` | powers/shield, powers/quake — https://opengameart.org/content/osare-10-sound-pack | Brandon Morris | CC BY 3.0 |
| `beast-death-0` | enemies/minotaur_die — https://opengameart.org/content/osare-minotaur-sounds | Brandon Morris | CC BY 3.0 |
| `screech-2`, `bird-death-0` | enemies/wyvern_phys, enemies/wyvern_die | Brandon Morris | CC BY 3.0 |
| `sparkle-0` | heal | remaxim | CC BY-SA 3.0 |
| `orc-0`, `orc-death-0` | enemies/goblin_phys, enemies/goblin_die — https://opengameart.org/content/drunk-dwarf-voice-pack | MaximB | CC BY-SA 3.0 |
| `spook-0` | enemies/skeleton_phys — https://opengameart.org/content/ghost-breath | Iwan "qubodup" Gabovitch | CC0 1.0 |
| `chitter-0` | enemies/antlion_phys — https://opengameart.org/content/insect-or-alien-scream-short | Iwan "qubodup" Gabovitch | CC0 1.0 |
| `spook-1` | enemies/zombie_phys (shortened) — https://opengameart.org/content/25-spooky-sound-effects | Bart K, via OpenGameArt.org | CC BY-SA 3.0 |
| `skeleton-death-0` | enemies/skeleton_die — https://opengameart.org/content/5-break-crunch-impacts | Ljudbank | CC0 1.0 |
| `bug-death-0` | enemies/antlion_die — https://opengameart.org/content/8-wet-squish-slurp-impacts | Ljudbank | CC0 1.0 |

## Minetest (`minetest-data`, `minetest-mod-nether`)

https://www.minetest.net/ — Minetest Game's sounds are © 2010–2023 celeron55
(Perttu Ahola) and the Minetest Game contributors (listed in its
`mods/default/license.txt`), CC BY-SA 3.0. The Nether mod's lava bubbles are
© 2019–2021 Treer, CC BY-SA 4.0.

| Files | Original |
|---|---|
| `dirt-0` | mods/default/sounds/default_dig_crumbly |
| `chips-0`…`chips-2` | mods/default/sounds/default_dig_choppy.1–3 |
| `lava-0` | mods/default/sounds/default_cool_lava.1 (faded), layered with the Nether mod's nether_lava_bubble and nether_lava_bubble.0 |

## Made for FanSong

These are synthesised for this game and dedicated to the public domain under
CC0 1.0:

- `dice-0`…`dice-5`: dice bouncing on a wooden table, modelled as damped
  resonances.
- `tweet-0`: cartoon birds circling a dazed head, as quick warbling chirps.
- `duh-0`: a dopey hummed "duh?" that lifts at the end like a question.
