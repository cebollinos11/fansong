# Point limits on run battles

## Context

In a run the enemy budget is a fixed curve of the step, and the player fields the whole roster (up to 12 units). A roster that snowballs outpoints every enemy, and nothing ever asks the player to choose *who* fights. Wanted: battles that limit the points the player may bring.

Decided with the user:

- **Every fight has a ceiling:** field at most **120%** of the enemy's cost.
- **Some plain battle nodes are tighter**, marked on the map:
  - **Skirmish**: a small enemy (about 100 pts whatever the step), and you field no more than it costs.
  - **Even**: field at most 100% of the enemy's cost.
  - **Underdog**: field at most 90%.
- **Payoff:** bonus XP for the units that fought a limited battle (not more gold).

Benching already exists (`bench` action, `fieldedUnits`), so this is a limit on the fielded warband's cost plus the node marks. No engine or protocol change; the golden replay is untouched.

## Rules

1. **The limit.** `RunBattle.limit` = points the player may field, set in `enterBattle` from the enemy actually met:
   `max(ceiling.floor, round(share × enemyCost))`, `share` = 1.2, or the node's kind's (1 / 1 / 0.9, no floor for those).
   Applies to battles, elites, bosses, rivals and ambushes alike.
2. **Opening floor (my addition, needs your eye).** A drafted warband is 150 pts against ~80–100 at step 1, and that edge is what makes step 1 survivable (see RUN_MODE.md Tuning). So the plain ceiling is never under `ceiling.floor` = 150 (= `draft.budget`): it starts to bind around step 4. Marked nodes are not placed before then either.
3. **Always a legal warband.** A lone unit may always be fielded, even over the limit. Fielding a second unit that goes over is refused.
4. **Briefing starts ready.** On entering a battle, benches are cleared and the roster is auto-fitted to the limit (leader first, then costliest that fits). So `startBattle` is always legal on arrival, and the sim's pilot needs no new picker. The `bench` action refuses a "field" that would go over ("needs 31 pts, 12 left"), so a swap is bench-then-field. Trade-off: a manual bench no longer carries to the next battle.
5. **Skirmish enemy.** The node's `budget` share is set to `skirmish.points / enemyPoints(step)`, so `generateEnemy` builds it unchanged (it may go over to make 3 units; the limit follows the real cost). Its reward is priced at threat 1, not at its tiny share, so it pays a normal battle's reward. Skirmishes appear only on steps where `enemyPoints(step) × mission.threat.min > skirmish.points`.
6. **Bonus XP.** On a win every fielded unit gets `limits.xp[kind]` extra (skirmish 1, even 1, underdog 2), added in `xpFor`. Plain ceiling: none.
7. **Where.** Only plain `battle` nodes (not row 1, elites, bosses or rival nodes), rolled by weight `limits.kinds` (none 70, skirmish 10, even 12, underdog 8) in a pass *after* the existing route rolls, so a seed keeps its map shape and node kinds.
8. **Map size.** The battlefield is sized for the units the limit lets through (auto-fit count) + the enemy's, not the whole roster.

## Changes

**`packages/content/src/run/`**
- `tuning.ts`: new `limits: { ceiling: { share: 1.2, floor: 150 }, kinds, skirmish: { points: 100, share: 1 }, even: { share: 1 }, underdog: { share: 0.9 }, xp }`.
- `types.ts`: `LimitKind = 'skirmish' | 'even' | 'underdog'`; `RouteNode.limit?: LimitKind`; `RunBattle.limit?: number` and `limitKind?: LimitKind`. All optional: saved runs load, `version` stays 3 (an absent limit means none).
- `route.ts` (`drawRoute`): the extra pass of rule 7; for a skirmish set `budget` and re-scout `threat`.
- `encounter.ts`: `battleLimit(enemyCost, kind?)`; `generateBattle` sizes the map per rule 8 (enemy first via `meet`, then the fitted count).
- `roster.ts`: `fieldedCost(s)`, `fitToLimit(s, limit)` (rule 4), reused by `enterBattle`.
- `run.ts`: `enterBattle` sets `limit`/`limitKind`, prices a skirmish's reward at threat 1, calls `fitToLimit` (replacing the "bench that leaves nobody" reset); `bench` enforces rule 3; `startBattle` asserts it. After a retreat the re-met node keeps its kind.
- `progress.ts`: `xpFor` takes the battle's `limitKind` bonus.
- `index` exports as needed.

**`apps/web/src/ui/`**
- `runView.ts`: `briefingView.fielded` → "5 units · 212 / 240 pts", a `limit` line naming the kind and its XP bonus; a refused Field shows `runActionError`'s reason through the existing `choice()`. `routeView` / node lines add the limit kind beside the skulls (`NODE_INFO`-style label + help).
- `RunScreen.tsx`, `RunMap.tsx`: render those; a small badge on limited nodes. Map blurb mentions the ceiling.

**`tools/cli/src/runSim.ts`**: `BattleStat` gains `limit`, `limitKind`, `rosterPoints`; the report adds a "by limit" table (fought / won) and roster-vs-fielded points per step.

**Docs**: RUN_MODE.md (rules, tuning table, deviations), README.md run section.

## Tuning

Baseline first (`pnpm play run --seeds 200 --route safe|balanced|greedy` on HEAD), then again with limits. Target unchanged: AI median death around steps 5–8, three routes level, step-1 deaths not up. Levers, in order: `ceiling.floor`, `ceiling.share`, `limits.kinds` weights, `limits.xp`. Known risk: a mirror is ~45% for the player's seat with the AI piloting, so Even/Underdog will read as deadly in the sim; judge them by their own row in the "by limit" table, and keep them avoidable on the map (never on every road of a row is not enforced; check how often it happens and add the rule if it does).

## Verification

- `pnpm typecheck`, `pnpm test`. New/extended tests in `packages/content/test/run/`:
  - `encounter`/`run`: limit = formula for each kind and the floor; briefing always startable on arrival; fielding over the limit refused; lone over-limit unit allowed; boss King stays fielded.
  - `route`: limited nodes only on plain battles past row 1, never rivals; same seed → same route; skirmish only where the step's budget is above it.
  - `progress`: bonus XP per kind.
  - existing 200-seed random walk of `legalRunActions` still never sticks.
  - `apps/web/test/run.test.ts`: briefing and route view-models; an old save without limits loads.
- Sim as under Tuning; same seed → same result.
- Live (web dev server, `?dev=1`, `window.fansongRun`): seeded run to a limited node; map badge; briefing shows limit and auto-fit; Field refused over the limit; win → bonus XP in the aftermath.
