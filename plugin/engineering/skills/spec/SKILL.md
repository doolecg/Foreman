---
name: spec
description: Write a short spec as an HTML page in the task folder: objective, decisions, test seams, commands, boundaries, out of scope. Use when the goal is agreed and you need a written target before slicing and building.
---

This skill writes down what is being built so the user and the agent aim at the same thing. Keep it short and about behaviour, not code. The rule that matters most: agree the test seams with the user before the spec is final.

## Use when

- The goal is agreed (after `frame`, or the request was already clear) and the work is more than a tiny fix.
- A change touches several files, a public surface, or something the user will want to review.
- You need a fixed target to check the finished work against.
- Skip when the task is one file with an obvious change. Put a two-line goal in notes.html instead.

## Steps

1. Read the code around the change so the spec uses the project's real names. Check for a spec already in `.foreman/engineering/<task-name>/`. If one exists for unfinished work, update it. Never overwrite it with a different task's spec.
2. Find the test seams: the places where behaviour can be checked from outside. Prefer existing seams. Choose the highest one that works. Fewer is better, and one is ideal.
3. Check the seams with the user in one short question, recommended seam first. Do not finish the spec until they agree.
   ```
   Test seam: <where behaviour will be checked, in plain words>
   Why this one: <it is the highest point that still shows the change>
   Alternative: <a lower seam, and what it would cost>
   ```
4. Find the real commands to build, test and typecheck by reading the project files. Do not guess them.
5. Write the page to `.foreman/engineering/<task-name>/spec.html` with these sections, in this order.
   - Objective: what is built and the check that proves it.
   - Who and why: the person who benefits and the reason now.
   - Decisions made: one line each, from the agreed answers.
   - Test seams: the agreed places where behaviour is checked, with the one ideal seam marked.
   - Commands: the exact build, test and typecheck commands.
   - Boundaries, out of scope, open questions.
6. Write boundaries as three short lists.
   - Always: things you do every time, such as running the checks before a commit.
   - Ask first: things that need the user's OK, such as a new dependency or a data change.
   - Never: things you will not do, such as weakening a test or touching secrets.
7. Re-read it as the user would.
   - Cut anything that is a file path or code.
   - Name only public things that already exist, such as a command, a screen or an API.
   - Check every success line can fail, and every term matches the project's own word for it.
8. Say the page path in full, give a three-line summary, and list the open questions. Then go to `slice`. The user approves this once, together with the slices.

## Rules

- Plain HTML, readable with no scripts, no external files. Short headings, short lists, GCSE reading level.
- Behaviour only. No file paths, no code, no class or function names that do not exist yet.
- State success as checks that can fail: a number, a command result, a visible outcome. "Fast" or "clean" is not a check.
- Every decision the user made in `frame` appears under decisions made, one line each.
- Out of scope is never empty. Name what you are choosing not to do.
- Keep open questions to real unknowns. A question you can answer by reading is not open.
- Match the project's existing words, tools and style. Add no new dependency to the plan without asking the user.
- Keep the spec current. If a decision changes during the build, update the page first, then the code.

## Stop and ask

- Three failed verify passes on the same problem.
- Anything risky or irreversible, such as data loss, a schema change or deleting user files.
- A wrong guess would be costly: an unclear seam, a command you cannot find, two readings of one requirement.
- The user has not agreed the seams.
- The spec would need a new dependency, a paid service or a closed tool.

## Excuses and answers

| Excuse | Answer |
| --- | --- |
| "It is a small change, no spec needed." | Small means a two-line goal in notes.html, not nothing. |
| "I will put the file paths in so it is exact." | Paths go stale. Name behaviour and existing public surfaces only. |
| "I will write the spec after the code." | Then it is documentation, not a target. Write it first. |
| "Open questions can wait until the build." | Real unknowns found late cost rework. List them now. |
| "I will choose the test seams myself." | The user agrees them. It takes one question. |
| "Success is that it works well." | Write a check that can fail, with a number or a result. |
