---
name: ship
description: Final stage of a task: check the definition of done with evidence, summarise the change, commit locally on the dev branch and report what waits for the user. Use when the work is built, tested and reviewed. Never pushes unless asked.
---

# Ship

This skill closes a task. It proves the work is done, writes a short summary and makes local commits. The rule that matters most: never push, tag, publish or release unless the user asks for it in that same turn.

## Use when

- The build, tests and review are finished and you are about to call the task done.
- The user asks for a summary, a commit or release notes.
- A task is being handed back after a long run.
- Skip when work is still failing. Go back to the build or diagnose step.

## Steps

1. Run the definition of done and quote real output for each line.
   - Tests pass and the project's own checks run clean.
   - The new behaviour was run, not only compiled.
   - No debug output, temp files or stray TODOs remain.
   - Only the task's files changed.
2. List anything not checked, such as behaviour in the running app, other platforms or slow paths.
   - Mark each one as unverified in plain words.
3. Write a short summary: what changed, why, how it was checked.
   - Keep it to a few lines. No headers needed.
   - Say whether it is a one-way or two-way door, meaning whether the user can undo it easily.
   - Name the blast radius, meaning what else could break.
   - For visual work, include before and after screenshots with full paths.
4. Commit locally on the current dev-<version> branch.
   - Use short plain messages that say what changed.
   - Add no AI attribution lines and no session links.
   - Stage only the task's files and read the staged diff first.
5. If the project keeps release notes, add the entry in the project's own format. Do not invent a format or a version number.
6. Write a one-line rollback note: the exact way to undo this change, for example reverting the commit.
   - If data or files change on disk, say where the backup is.
   - If undoing is not possible, say so plainly.
7. Tell the user what is waiting for their go: push, tag, publish or release. Say that nothing was sent anywhere.
8. Tick the checklist in `.foreman/engineering/<task-name>/slices.html`, then give the final report.

## Rules

- Lead the report with the result. Short, plain words.
- Never push, tag, publish or release unless the user asks in the current turn.
- Never say tests pass without running them this turn and quoting the result.
- Unverified items are listed plainly. Do not bury them or soften them.
- Do not weaken, skip or delete tests to get green.
- Commit messages are short and plain. No attribution lines of any kind.
- Keep keys and secrets out of the commit. Check the staged diff.
- A one-way door needs the user's approval before you go further.

## Stop and ask

- Three verify passes failed on the same problem.
- Any step that sends something outside this machine.
- The change deletes data or files, or cannot be undone.
- Anything risky or irreversible.
- A wrong guess would be costly, such as an unknown version or release format.

## Excuses and answers

| Excuse | Answer |
|---|---|
| It built, so it works. | Run it and quote the result. If you did not, say unverified. |
| The user will want it pushed. | Maybe. Ask. Commit locally and wait for the word. |
| I will add a co-author line, it is polite. | No attribution lines. Keep the message short and plain. |
| Screenshots are extra work. | Visual change needs before and after. Without them nobody can judge it. |
| A rollback note is overkill. | One line costs nothing and saves the user time. |
| I will fix this unrelated bug while I am here. | Under 5 lines, fix and report it. Otherwise mention it in one line. |
