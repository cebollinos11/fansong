---
name: apply-presets
description: Apply a preset file exported by FanSong's dev preset editor (fansong-presets.json) to the game's code — rewriting the shared preset units, warband rosters and default matchup, then fixing whatever still names the old ids or units. Use when the user hands over (attaches, pastes or points to) a fansong-presets.json / presets export, or asks to "update the units/presets/warbands from this file".
---

# Apply a preset editor export

The dev preset editor (`?dev=1` → **Preset units…**, `apps/web/src/ui/PresetEditorScreen.tsx`) exports
`fansong-presets.json`: the shared units, every warband's roster (unit × count), warband ids and order,
the default matchup, and a `changes` list in words. Applying it means making the code match that file
exactly, then leaving the repo green.

The mechanical part is a script; your job is running it and the follow-up it can't do.

## 1. Get the file

- A path the user gives: use it as is.
- Pasted or attached content: write it to the scratchpad as `fansong-presets.json`.
- It must be JSON with `"format": "fansong-presets"`. Any `version` works (the script migrates old ones).

Check `git status` first. If there are unrelated uncommitted changes, say so and keep them out of this work.

## 2. Check, then apply

```sh
pnpm --filter @fansong/web apply-presets <file> --check   # validate + report, writes nothing
pnpm --filter @fansong/web apply-presets <file>           # rewrite the code
```

`apps/web/scripts/apply-presets.ts` parses the file with the editor's own parser, and **refuses** a file
the editor would flag (bad stats, too few units, clashing names or ids, a matchup naming a missing
warband). If it refuses, relay its problem list to the user — they fix it in the editor and re-export.
Don't hand-edit the file or the code to get around the check.

On success it rewrites `PRESET_UNITS` and `PRESET_ROSTERS` in `packages/content/src/presets.ts` and
`DEFAULT_SETUP.presets` in `packages/content/src/match.ts`, then re-imports the content package in a
fresh process and verifies every warband expands to exactly what the editor showed. Untouched units
keep their exact text, so the diff shows only what changed. Units are keyed by name in code: a renamed
unit's key becomes its new name.

Keep the report it prints — the follow-up works from it.

## 3. Follow up on the report

**Warband ids renamed or deleted.** Other code and tests name preset ids as strings. Search for each
old id in quotes (`'old-id'`) across the repo, excluding `node_modules`, and update every hit —
tests, CLI help/tests, `README.md`, the worker, protocol tests. For a deleted id, point the reference at
whichever remaining preset gives that code what it needs (size, a trait, a shooter, …).

**The design comment atop `presets.ts`.** It describes each warband by id. Rename, remove or add
entries to match. For a new warband, write one line of design intent from its roster and tell the user
you drafted it.

**Units renamed or deleted.** Search for the old names in quotes in tests and docs and update them.
Leave `UNIT_SPRITES` keys (`apps/web/src/three/unitSprites.ts`) alone: the editor kept a renamed unit's
sprite by setting `look` to the old name, and players' saved armies reference those keys through their
own `look` too.

**Units with no sprite.** They'll be drawn with the fallback. Don't pick art yourself; tell the user
and offer to import a sprite (see the Wesnoth sprite pipeline memory, if present).

**Unused units.** They stay in `PRESET_UNITS`. Mention them; delete them only if the user asks.

## 4. Make the repo green

```sh
pnpm typecheck
pnpm test
```

Most failures after a real change are tests that name a specific preset, unit or the default matchup
(e.g. tests that build from `DEFAULT_SETUP` and expect Iron Wardens' units, or the preset editor's own
tests, which use shipped unit names like `Bear`, `Wolf`, `Levy`). Fix them by keeping each test's
intent and retargeting it at the new data — another unit with the same trait, the new id, an explicit
preset instead of `DEFAULT_SETUP` if the test depends on specific units. Never loosen an assertion or
delete a test just to get green; if a test's expectation is really a balance judgement the new stats
contradict, stop and ask the user.

The golden replay (`packages/engine/test/fixtures/golden-replay.json`) doesn't depend on the presets,
so it should not change. If it does, something else broke.

## 5. Report back

Tell the user, briefly:

- what changed in the game (the `changes` list, in plain words);
- what follow-up you did (ids/names updated in N files, tests retargeted, comment entries drafted);
- anything that needs them: units without sprites, drafted warband blurbs to review;
- that the editor's autosaved draft in their browser was made against the old presets — they should
  click **Reset all** in the editor before making the next round of changes.

Don't commit or push unless they ask.
