---
name: flow
description: The engineering lifecycle from idea to local commit. Picks the stages a task needs, holds the one plan approval gate, then runs to done. Use when starting any code task in Engineering Mode, or when unsure which engineering skill applies.
---

This skill is the route map for the other engineering skills. It decides which stages a task needs and in what order. The one rule that matters most: the user approves the plan once, and after that you run to the end without stopping, unless a stop-and-ask rule fires.

## Use when

- A new task arrives and you must decide how much process it needs.
- You are between stages and need to know what comes next.
- The user asks what the workflow is or where you are in it.
- Skip when the task is a question, a read-only look, or a change of a few lines with no risk. Just do it and verify it.

## Steps

1. Size the task and pick the route. Say the route in one line.
   - Tiny (one file, clear cause or clear change): `build` or `diagnose`, check, `ship`.
   - Small (a few files, clear goal): a short `spec`, then `build`, check, `ship`.
   - Anything bigger or vague: every stage, in the order below.
2. Create the task folder `.foreman/engineering/<task-name>/` in the project. It is gitignored. It holds spec.html, slices.html and notes.html.
3. Run `frame` if the goal is unclear. Look facts up yourself and ask the user only the decisions. Then run `spec` to write the spec, then `slice` to write the checklist of thin slices.
4. Show the plan in this shape, then wait for the user's OK. This is the only approval gate. Do not write code before it.
   ```
   Goal: <one line>
   Slices: <numbered list, one line each, in order>
   Checks: <the commands that will prove it>
   Risk: <one line>
   Not doing: <one line>
   ```
5. Build one slice at a time with `build`, using `test-first` for new behaviour and `diagnose` for bugs. Tick the slice off in slices.html when its check passes. Make one local commit per slice.
6. Run the project's checks after each slice and again at the end. Use `design` for visual work and `harden` for input, security or data risk.
7. Run `review` on the whole change. Use `doubt` on any decision you are unsure of and `simplify` if the result is bigger than it needs to be.
8. Run `ship` to finish locally: final checks, the commit, the notes. Run `retro` only if the user asks or the task went badly.
9. Report the result first, in this order, and keep it short.
   - What now works and the path to run or open it.
   - Checks run this turn, with the result quoted.
   - Unverified items, listed plainly.
   - The commit, and a one-line risk.

## Rules

- Stages you skip must be skipped on purpose and named in the plan. Never skip verify.
- Definition of done: the checks ran this turn and their results are quoted, review is done, the work is committed locally, unverified items are listed, and a one-line risk summary is given.
- Commit only on the current dev branch, with short plain messages and no AI credit lines. Do not push, publish or tag. Those are the user's call.
- Verify budget: three passes (one run of checks plus the fix) on the same problem. After the third, stop and ask.
- Keep to the plan. A new idea gets one line in the summary, not a new feature. If scope grows, stop and say what grew and why.
- Keep context small. Read only what you need and run noisy commands so only the answer comes back.
- If the session gets long, write a short handoff note in `.foreman/engineering/<task-name>/notes.html`: goal, done, next, open risks. A fresh session can then pick up from the folder.
- Do not compress or restart in the middle of a slice. Do it between slices, when the notes are up to date.
- One build or test run at a time. Check the PC is not already busy before heavy work. No dev servers unless the user asks.
- Use helper agents only for big or parallel jobs, never more than three, and never two on the same file. If your tool cannot start helpers, do the steps yourself in order.

## Stop and ask

- Three failed verify passes on the same problem.
- Anything risky or irreversible: deleting data, overwriting the user's work, changing secrets, anything outside the project.
- A wrong guess would be costly and the code or spec does not answer it.
- The spec and the code disagree, or two readings of the request mean really different work.
- Scope grows beyond what the user approved.
- An unfinished plan for different work already exists in the task folder.

## Excuses and answers

| Excuse | Answer |
| --- | --- |
| "It is obvious, I will skip the plan." | Size it first. A tiny task skips stages on purpose. A big one gets the gate. |
| "I will ask the user at each step to be safe." | One gate only. After the OK, run to the end. |
| "Tests probably pass." | Run them now and quote the result, or call it unverified. |
| "One more fix pass will do it." | Three passes is the cap. Stop and ask. |
| "I will push so the user can see it." | Never push. Commit locally and say where. |
| "I will tidy this nearby code while I am here." | Not asked, not touched. Put it in one line. |
