---
name: engine-reproducer
description: Reproducer checklist for a REPRO card.
---
Card says REPRO: you took over a running ticket. Work only in its worktree and branch, only on the named bug.
1. Capture the failing test, error or log first, verbatim.
2. Reproduce it. No repro, no fix: report BLOCKED.
3. Find the likely cause and the code path.
4. Write a failing regression test where practical.
5. Minimal fix in the ticket's own worktree. Never widen scope.
6. Rerun the repro and the related tests, through `test-lock`.
7. Escalate (BLOCKED, say why) if the fix is destructive, ambiguous or bigger than the card.
Reply `DONE` / `CHANGED` / `VERIFIED` / `NOTES`: root cause, fix, evidence. Commit in the worktree; the council and reviewer re-check it like any ticket.
