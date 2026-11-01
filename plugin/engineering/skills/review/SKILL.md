---
name: review
description: Review the changes made since a fixed starting commit on two separate axes, Standards and Spec, with a fresh pair of eyes. Use when a task's code is written and before it ships, or when the user asks for a review.
---

# Review

This skill checks finished work before it ships. The reviewer must not share the author's frame of mind: use a fresh helper agent if your tool can start one, otherwise do a deliberate second pass after clearing your assumptions. The one rule that matters most: never approve without saying what you actually checked.

## Use when

- The build is done and tests are green, before the ship step.
- The user asks you to review a branch, a diff or recent work.
- A fix took more than one try and you want a second look.
- A change touches input, files, processes or secrets (run harden as well).
- Skip when the change is a typo, a comment or a pure rename with no behaviour.

## Steps

1. Pin the fixed point: the commit the task started from. Ask the user if it is not in the task notes.
   - Check that the point resolves and that the diff is not empty.
   - Read the full diff and the commit list since that point.
2. Find the spec at `.foreman/engineering/<task-name>/spec.html`. If there is none, say so and skip the Spec axis.
3. Collect the repo's own written rules: the project instructions file, contributing notes, lint and type settings.
   - Anything a tool already enforces is not worth a finding.
   - Run the project's own check command once and note the result.
4. Review the tests first, because they show what the author believed.
   - Do they check behaviour, edge cases and error paths?
   - Would they fail if the code broke? Test that by flipping one condition, running the tests once, then restoring the file from a copy.
5. Report on Standards, in under 400 words.
   - Does the change follow this repo's own rules?
   - Is it readable, does it fit the architecture, and does it avoid obvious speed traps?
6. Report on Spec, separately, in under 400 words.
   - Does the change do what the spec says, and handle bad input and error paths?
   - Are the security basics kept: input checks, no secrets, no unsafe paths? Quote the spec line for each finding.
7. Give each finding a severity, the file and line, the failure scenario and the fix in one line. Order the worst first.
   - Example: should-fix, src/save.ts line 40, an empty name saves a blank file, reject empty names.
8. The author fixes every blocker and should-fix, then re-checks the changed parts.
   - Repeat for up to 3 rounds, then stop and ask the user.
   - Close with one line per axis: how many findings and the worst one.
   - Do not sum the axes into one score.

## Rules

- Severities are blocker (wrong, unsafe or data loss), should-fix (real problem, not fatal) and nit (taste, optional).
- A finding without a file, a line and a failure scenario is an opinion. Drop it or sharpen it.
- Judgement-call smells are flagged, never auto-fixed. Examples: the same logic copied in two places, a function that mostly uses another object's data, a new abstraction nobody needs yet, a change that forces edits in many files, a vague name.
- A documented repo rule beats a general smell. If the repo allows it, do not flag it.
- Keep the two axes apart. Do not merge them or rank one above the other.
- Zero findings is allowed only with a short list of what you checked and how.
- Review is read-only until the fix round. Do not reformat, rename or tidy code outside the diff.
- Quote real command output for any claim that something passes or fails.

## Stop and ask

- Three review rounds on the same problem and blockers remain.
- A fix would touch code outside the task, or change a public interface.
- The spec and the code disagree and you cannot tell which one is right.
- Anything risky or irreversible, such as deleting files or rewriting history.
- A wrong guess would be costly, such as an unclear fixed point.

## Excuses and answers

| Excuse | Answer |
|---|---|
| The tests pass, so it is fine. | Tests prove what they check. Read them first and see what they miss. |
| I wrote it, so I know it is right. | Authors share their own blind spots. Use a fresh reader. |
| The diff is small, no need for two axes. | Small diffs still break rules or miss the spec. Both axes take minutes. |
| I will skip the nits to be kind. | Fine, but list them as nits. Never hide a real problem to be polite. |
| No findings, so I can write LGTM. | Write what you checked. An empty approval tells nobody anything. |
| This smell is obvious, I will just fix it. | Smells are judgement calls. Flag it and let the user or author decide. |
