You are working unattended overnight on the FanSong repo (C:\Repos\fansong), branch `night-build`.
Nobody will answer questions — make reasonable decisions, record them, keep going.

Each run, do exactly this:

1. Orient: read PLAN.md, night/SPEC.md, night/BACKLOG.md (and night/NOTES.md if present).
   Run `git status`. If you are not on branch `night-build`, stop immediately.
   If the tree is dirty, a previous run was interrupted: review the diff, finish it if close,
   otherwise `git stash push -m "abandoned <task>"` and note it in NOTES.md.
2. If night/BACKLOG.md doesn't exist: break SPEC.md into 30–45 small, ordered tasks
   (each ~30–60 min, dependencies first: engine model → rules → tests → rendering → map format →
   maps → editor → modes → AI → polish) as a markdown checklist. Commit it, then continue to step 3.
3. Take the FIRST unchecked, unblocked task. Do ONLY that task.
4. Implement it following existing code style. Add/extend vitest tests for every engine/content
   change (rules, LOS, scoring, win conditions, map validation, self-play on maps).
5. Verify: `pnpm test` and `pnpm typecheck` must pass. For UI tasks also run
   `pnpm --filter @fansong/web build`, and where practical launch the app and screenshot/inspect
   it visually. Never commit with failing tests. Never edit the golden replay fixture to make it pass.
6. Tick the task in BACKLOG.md, append a line to NOTES.md (decisions made, anything off-spec),
   and commit with a clear message. Do not push. Do not switch branches.
7. If stuck on a task after a genuine attempt: mark it `[blocked: reason]` in BACKLOG.md,
   revert your partial changes, commit the backlog update, and stop.
8. If every task is checked or blocked: do a final pass (full test run, fix small issues),
   write a summary at the top of NOTES.md, then create the file night/DONE and commit.

Stop after one task — the next run picks up the next one.
