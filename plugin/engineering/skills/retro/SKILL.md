---
name: retro
description: Look back at a task that went wrong or took many passes, find the kind of mistake, and propose at most three fixes to the working setup. Use when the user asks for a retro, or after repeated failed passes.
---

# Retro

This skill turns a bad run into a better setup. It finds why the work went wrong and proposes small, lasting fixes. The rule that matters most: if a machine can catch the mistake, build the check; do not write another rule for the agent to remember.

## Use when

- A task took many passes or ended with a mistake the user had to point out.
- The user asks for a retro or asks why something keeps going wrong.
- The same kind of error shows up in a second task.
- Skip when the run was clean. There is nothing to learn.

## Steps

1. Read what happened: the task notes in `.foreman/engineering/<task-name>/`, the commit list and the checks that failed.
   - Do not rely on memory.
   - Note which step went wrong first, since later errors often follow from it.
2. Name the mistake class for each problem.
   - Navigation: could not find the right place.
   - Missing check: no test or lint would have caught it.
   - Unclear standard: the rule was vague or absent.
   - Slow tool: an expensive command.
   - No-op: a rule that changed nothing.
3. Decide mechanical or judgement.
   - Mechanical means a fixed pattern a script can spot, such as a banned call or a wrong import.
   - Judgement means a human reading, such as matching the surrounding style.
4. Mechanical mistakes get an automatic check: a test, a lint rule or a small script.
   - Read the repo's existing check commands first. The gap may be a check that exists but is not wired in.
5. Judgement calls get one short, positive line in the project's rules file.
   - Propose the exact wording and the file.
   - Wait for the user's approval before editing.
6. Look for rules that no longer earn their place: lines that repeat each other, point at things that are gone, or never change what the agent does.
   - Propose deleting them.
7. Rank the findings, worst first, and keep at most three proposals.
   - Give each one a one-line reason and the full path of the file it touches.
   - Say which mistake class each one fixes.
   - If nothing needs changing, say that and stop.
8. Report the proposals and wait. Make no edits until the user approves.

## Rules

- Maximum 3 proposed changes per retro, worst first.
- Prefer a check over prose. A rule that a script could enforce is a gap in the setup.
- Keep rules short and positive: say what to do, not a list of things to avoid.
- A rule must pass the no-op test: if removing it would not change what the agent does, delete it.
- No new files unless the user asks. Extend an existing check or file first.
- Never edit the rules file, the user's global settings or shared skills without approval.
- Describe the cause in the setup, not in the person or the model.
- Do not touch the code from the failed task during a retro.

## Stop and ask

- Three verify passes failed on the same problem.
- A proposal would edit a shared or global file.
- A fix needs a new tool, dependency or service.
- Anything risky or irreversible.
- A wrong guess would be costly.

## Excuses and answers

| Excuse | Answer |
|---|---|
| I will add a rule so it never happens again. | Can a script catch it? Build that. Rules fade, checks stay. |
| More rules cannot hurt. | Every line costs attention in every task. Prune as you add. |
| I will list everything I found. | Three at most, worst first. A long list gets ignored. |
| I will create a lessons file. | No new files unless asked. Use an existing one. |
| The model was just bad this time. | Find the setup gap. The same gap will trip the next run. |
| I will edit the rules now, it is obvious. | Propose the wording and wait. The user owns the rules file. |
