# Stock sound credits

The game's own sounds are recorded in the recording booth (`public/sfx/`).
Until a cue has a recording, it plays one of these stock clips instead, where
one fits (see `STOCK` in `src/audio/sfxCues.ts`). Every file here is
`<clip>-<n>.mp3`, one variant of a clip set. The files were converted to mono
MP3, trimmed of leading and trailing silence, and peak-normalised; nothing else
was changed, except where noted.

They come from four free projects, each taken from its Ubuntu 24.04 (noble)
package, plus a few synthesised for this game. Their licences:

- **CC0 1.0** (public domain): no conditions.
- **CC BY 3.0 / 4.0**: free to use with credit, given below.
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

## Lugaru (`lugaru-data`)

https://osslugaru.gitlab.io/ — sounds © 2003, 2010 Wolfire Games, CC BY-SA 3.0.

| Files | Original |
|---|---|
| `swing-0`…`swing-2` | LowWhoosh, MidWhoosh, HighWhoosh |
| `heavy-hit-0` | HeavyImpact |
| `clang-0`…`clang-3` | Clank1–Clank4 |
| `thud-0`…`thud-2` | Thud, Land1, Land2 |

## MegaGlest (`megaglest-data`)

https://megaglest.org/ — © 2001–2008 The Glest Team, 2008–2017 The MegaGlest
Team, CC BY-SA 3.0.

| Files | Original |
|---|---|
| `bow-0`…`bow-3` | techs/megapack/commondata/sounds/archer_attack1–4 |
| `arrow-hit-0`…`arrow-hit-4` | techs/megapack/commondata/sounds/arrow_hit1–5 |

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

## Made for FanSong

`dice-0`…`dice-5` are synthesised (dice bouncing on a wooden table, modelled as
damped resonances), made for this game and dedicated to the public domain
under CC0 1.0.
