# More than two players (team games)

The player count is fixed at 2 today. This note sizes the work to support team
games (2v1, 2v2, 3v2 and so on), both local and online, while keeping the
existing maps' spawn zones and flag bases.

## The approach: teams are the two sides

The engine's two players (`Owner = 0 | 1`) are used as *sides* everywhere:
`benched`, `broken`, `startCount`, scores, the two CTF flags, the two kings,
deploy zones, flee edges (`homeColumn`), and `other(current)` in turn passing.

If `Owner` stays a **team** and each player becomes a seat inside a team, almost
all of that keeps working unchanged:

- Flag bases, CTF, both spawn zones, and hill/conquest scoring.
- Morale, rout thresholds, and fleeing to your own edge.
- Win checks (annihilation, king, flag).
- The AI, which already plays a side, so it can play a team.

A full "N independent players" engine would cost several times more and isn't
needed for team play.

## What has to change

| Area | Size | Notes |
|---|---|---|
| **Engine** (`packages/engine/src/types.ts`, `advanceTurn` in `reduce.ts`) | Small | Add an optional `controller` (seat index) to `Unit`, and a per-team rotation so turns go A1 → B1 → A2 → B2…, skipping seats with nothing left to activate. `ChooseActivation` also checks that the unit belongs to the seat whose turn it is. Keep the new fields optional (as `mode` already is) so existing replay hashes don't change. |
| **Match setup / deploy** (`packages/content/src/match.ts`, `deploy.ts`) | Small–medium | `seats: [Seat, Seat]` becomes `teams: Seat[][]`, each seat with its own warband. Each team's single deploy zone gets split between its players (for example, by rows), so maps stay as they are. |
| **Protocol + room** (`packages/protocol/src/schema.ts`, `apps/worker/src/room.ts`) | Medium | The fixed `[0, 1]` seat holders, presence, ready flags and the "room already has two players" error become an N-seat list with a team per seat. The command check changes from `state.active === seat` to "is it this seat's turn". The lobby schema tuples become arrays. Room tests need updating. |
| **AI** (`packages/ai`) | Small | It only has to pick among its own seat's units. It already avoids its teammates, because they're the same side. |
| **UI** | Medium–large (the biggest part) | The lobby with team slots; local setup for N seats (hotseat plus AI mixes); the HUD and log showing *which player* is up, not just which side; a colour per player within a team colour; the online client knowing its seat; game-over text. |

Rough estimate: the engine, content, AI and room changes are a few focused
sessions. The UI is about as much again.

## Rule decisions to make first

1. **Turnover scope.** Does a turnover bench just that player or the whole
   team? Per player feels better (one bad roll doesn't sideline a teammate), and
   it's a small change: `benched` becomes per seat.
2. **Turn cadence and budgets.** If the teams alternate one activation at a
   time, the solo player in a 2v1 acts twice as often as each opponent. That's
   fair only if the solo player's army is worth as much as the other team's two
   combined, so points budgets should probably be per team, split among its
   players.
3. **Kill the King.** One king per team, where losing it loses the game? Or one
   per player?
4. **Rout.** Keep it per team. Per player would complicate things.

## Suggested order

Start with the engine and room changes behind tests, using a hotseat 2v2 on an
existing map to prove the rules. Build the lobby UI after that.
