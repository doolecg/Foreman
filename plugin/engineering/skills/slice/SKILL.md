---
name: slice
description: Turn the spec into thin vertical slices in a tick-off HTML checklist, each with acceptance criteria, a proving check, size and blockers. Then show the plan for the one OK. Use after the spec is written and before any building.
---

This skill breaks the spec into small steps that each work on their own. A slice cuts through every layer it needs and can ship alone. The rule that matters most: the slices are shown to the user once, and nothing is built until they say OK.

## Use when

- A spec exists and the work needs more than one step.
- The task feels too big to start, or the order is unclear.
- You need a checklist that survives a long session or a fresh one.
- Skip when the whole task is one small slice. Tick one item and build.

## Steps

1. Read the spec and the code it touches. Note the existing patterns, the risky parts and the unknowns.
2. Check `.foreman/engineering/<task-name>/slices.html`. If it has unticked items for the same work, update it in place. If it holds a different unfinished plan, stop and ask. Never overwrite it.
3. If the code is in the way, make the first slice a small prefactor: change the structure with no change in behaviour, so the real change is easy.
   - Keep it small. A prefactor that grows is a sign to stop and ask.
   - Its proof is that the existing checks still pass.
4. Cut the rest into vertical slices. Each one delivers one behaviour end to end (data, logic, screen, test), never one layer alone. Put risky or unknown work early so it fails fast.
5. For a wide change that would break many places at once, such as a rename or a changed shared type, use expand, migrate, contract.
   - Expand: add the new form beside the old, so nothing breaks.
   - Migrate: move callers over in batches, one slice each, checks green after every batch.
   - Contract: remove the old form last, once nothing uses it.
6. Write each slice in this shape. Split anything XL, and any title that contains "and".
   ```
   [ ] 3. <short title: the behaviour that now works>
       Size: XS one file | S one or two | M three to five | L five to eight
       Blocked by: <slice numbers, or none>
       Done when: <criterion that can fail> / <criterion>
       Proof: <the command or visible result that shows it>
   ```
7. Write the checklist to `.foreman/engineering/<task-name>/slices.html` with a tick box per slice and per criterion. Add a check-in line after every two or three slices.
8. Show the user the plan and wait for a clear OK. Fix what they change and show it again.
   - The spec in three lines.
   - The slices in order, one line each, with sizes and blockers.
   - The checks that will prove the work, and the risk in one line.
   - The full path of spec.html and slices.html.

## Rules

- Each slice leaves the project building and its checks passing. Never a half-working state between slices.
- Acceptance criteria are checks that can fail. Name the command or the visible result that proves each one.
- Slices are ordered by blockers, not by what seems important. A slice with no blockers can start now.
- Three criteria or fewer per slice. More means it is two slices.
- Name the behaviour, not the file. Paths and code do not belong in the plan.
- Tick items off as they finish. The page is the single record of progress.
- Add no slice for work that is not in the spec. Mention the idea in one line.
- If the plan changes after the OK, update slices.html first and show the user only what changed.

## Stop and ask

- Three failed verify passes on the same problem.
- Anything risky or irreversible, such as a data migration or deleting user files, sits in the plan.
- A wrong guess would be costly: you cannot tell which layer owns a behaviour, or two orders give different results.
- An unfinished plan for different work already exists.
- The user has not answered the OK. Do not start building while waiting.

## Excuses and answers

| Excuse | Answer |
| --- | --- |
| "I will do the database first, then the screens." | That is a layer, not a slice. Cut through every layer for one behaviour. |
| "This slice is big, but it is one thing." | If it is XL or has two jobs, split it. |
| "The old plan is stale, I will replace it." | Unticked items may be live work. Stop and ask. |
| "I will list the files each slice touches." | Files go stale. Name the behaviour and the check. |
| "The user will trust me, so I will start now." | One OK is the gate. Wait for it. |
| "A rename touches everything, so one slice." | Use expand, migrate, contract so each step stays green. |
